import type { Request, Response } from 'express';

import {
  CORRELATION_ID_MAX_LENGTH,
  CorrelationMiddleware,
} from './correlation.middleware';
import { correlationStorage, getCorrelationId } from './correlation';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fakeRequest(headerValue?: string): Request {
  return {
    header: (name: string) =>
      name === 'X-Correlation-Id' ? headerValue : undefined,
  } as unknown as Request;
}

function fakeResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('CorrelationMiddleware', () => {
  it('reuses a valid inbound X-Correlation-Id, echoing it back in the response header', () => {
    const middleware = new CorrelationMiddleware();
    const req = fakeRequest('client-supplied-id-123');
    const { res, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(req, res, () => {
      observed = getCorrelationId();
    });

    expect(observed).toBe('client-supplied-id-123');
    expect(headers['X-Correlation-Id']).toBe('client-supplied-id-123');
  });

  it('generates a UUID and echoes it back when no header is present', () => {
    const middleware = new CorrelationMiddleware();
    const req = fakeRequest(undefined);
    const { res, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(req, res, () => {
      observed = getCorrelationId();
    });

    expect(observed).toMatch(UUID_PATTERN);
    expect(headers['X-Correlation-Id']).toBe(observed);
  });

  it('rejects an inbound id longer than CORRELATION_ID_MAX_LENGTH and generates one instead', () => {
    const middleware = new CorrelationMiddleware();
    const tooLong = 'a'.repeat(CORRELATION_ID_MAX_LENGTH + 1);
    const req = fakeRequest(tooLong);
    const { res, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(req, res, () => {
      observed = getCorrelationId();
    });

    expect(observed).toMatch(UUID_PATTERN);
    expect(headers['X-Correlation-Id']).not.toBe(tooLong);
  });

  it('rejects an inbound id with characters outside [A-Za-z0-9-] and generates one instead', () => {
    const middleware = new CorrelationMiddleware();
    const req = fakeRequest('not valid\nwith newline');
    const { res, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(req, res, () => {
      observed = getCorrelationId();
    });

    expect(observed).toMatch(UUID_PATTERN);
    expect(headers['X-Correlation-Id']).not.toContain('\n');
  });

  it('does not leak the correlationId outside the run() scope it was stored in', () => {
    const middleware = new CorrelationMiddleware();
    const req = fakeRequest('scoped-id');
    const { res } = fakeResponse();

    middleware.use(req, res, () => undefined);

    expect(correlationStorage.getStore()).toBeUndefined();
  });
});
