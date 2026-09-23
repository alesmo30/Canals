import { randomInt } from 'node:crypto';

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL'] as const;

export function pickRandomCarrier(): string {
  return CARRIERS[randomInt(CARRIERS.length)];
}

function randomDigits(length: number): string {
  return Array.from({ length }, () => randomInt(10)).join('');
}

/** Carrier-shaped, not carrier-verified — mock QA data, not a real tracking format guarantee. */
export function generateTrackingNumber(carrier: string): string {
  switch (carrier) {
    case 'UPS':
      return `1Z${randomDigits(16)}`;
    case 'FedEx':
      return randomDigits(12);
    case 'USPS':
      return randomDigits(22);
    case 'DHL':
      return randomDigits(10);
    default:
      return randomDigits(12);
  }
}
