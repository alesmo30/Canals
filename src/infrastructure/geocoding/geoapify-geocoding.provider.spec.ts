import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';

import { GeocodingFailedError } from '../../domain/ports/geocoding-errors';
import { ShippingAddress } from '../../domain/value-objects/shipping-address';
import { GeoapifyGeocodingProvider } from './geoapify-geocoding.provider';

const API_KEY = 'super-secret-geoapify-key';

interface FakeServer {
  url: string;
  requestCount: () => number;
  requestUrls: () => string[];
  close: () => Promise<void>;
}

function startFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<FakeServer> {
  return new Promise((resolve) => {
    const urls: string[] = [];
    const server = createServer((req, res) => {
      urls.push(req.url ?? '');
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requestCount: () => urls.length,
        requestUrls: () => urls,
        close: () =>
          new Promise((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

function jsonHandler(
  status: number,
  body: unknown,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

function buildAddress(): ShippingAddress {
  return ShippingAddress.of({
    recipient: 'Jane Doe',
    line1: '350 5th Ave',
    city: 'New York',
    state: 'NY',
    postalCode: '10118',
    country: 'US',
  });
}

describe('GeoapifyGeocodingProvider', () => {
  let server: FakeServer | undefined;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    errorSpy.mockRestore();
  });

  it('maps a features[0] response to Coordinates', async () => {
    server = await startFakeServer(
      jsonHandler(200, {
        type: 'FeatureCollection',
        features: [{ properties: { lat: 40.7128, lon: -74.006 } }],
      }),
    );
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    const coordinates = await provider.geocode(buildAddress());

    expect(coordinates.getLatitude()).toBe(40.7128);
    expect(coordinates.getLongitude()).toBe(-74.006);
  });

  it('throws UNKNOWN_ADDRESS for an empty features array', async () => {
    server = await startFakeServer(
      jsonHandler(200, { type: 'FeatureCollection', features: [] }),
    );
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    await expect(provider.geocode(buildAddress())).rejects.toMatchObject({
      reason: 'UNKNOWN_ADDRESS',
    });
  });

  it('throws PROVIDER_UNAVAILABLE after three consecutive 503s', async () => {
    server = await startFakeServer(
      jsonHandler(503, { error: 'service_unavailable' }),
    );
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    await expect(provider.geocode(buildAddress())).rejects.toMatchObject({
      reason: 'PROVIDER_UNAVAILABLE',
    });
    expect(server.requestCount()).toBe(3);
  });

  it('throws after exactly one request on a 401, leaving the breaker CLOSED', async () => {
    server = await startFakeServer(jsonHandler(401, { error: 'unauthorized' }));
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    await expect(provider.geocode(buildAddress())).rejects.toMatchObject({
      reason: 'PROVIDER_UNAVAILABLE',
    });
    expect(server.requestCount()).toBe(1);

    // BREAKER_FAILURE_THRESHOLD is 5. If a 401 counted against the
    // breaker, five of them would open it and this sixth call would be
    // rejected before ever reaching the server (request count stuck at
    // 5). It reaching the server for a 6th time proves 401 never counted.
    for (let i = 0; i < 4; i++) {
      await provider.geocode(buildAddress()).catch(() => undefined);
    }
    expect(server.requestCount()).toBe(5);

    await provider.geocode(buildAddress()).catch(() => undefined);
    expect(server.requestCount()).toBe(6);
  });

  it('retries a 429 like any other transient failure', async () => {
    let calls = 0;
    server = await startFakeServer((_req, res) => {
      calls++;
      if (calls < 2) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ features: [{ properties: { lat: 1, lon: 2 } }] }),
      );
    });
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    const coordinates = await provider.geocode(buildAddress());

    expect(coordinates.getLatitude()).toBe(1);
    expect(server.requestCount()).toBe(2);
  });

  it('never lets the API key reach a log line or an error message', async () => {
    server = await startFakeServer(jsonHandler(403, { error: 'forbidden' }));
    const provider = new GeoapifyGeocodingProvider({
      apiKey: API_KEY,
      baseUrl: server.url,
      timeoutMs: 50,
      retryPolicy: { baseDelayMs: 0 },
    });

    let thrown: unknown;
    try {
      await provider.geocode(buildAddress());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GeocodingFailedError);
    expect((thrown as Error).message).not.toContain(API_KEY);
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(API_KEY);
    }
  });
});
