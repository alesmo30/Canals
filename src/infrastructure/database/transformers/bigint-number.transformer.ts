import { ValueTransformer } from 'typeorm';

/**
 * pg returns bigint as a string. Money columns (cents) sit far below
 * MAX_SAFE_INTEGER, so convert to number to match Money. Money columns only.
 */
export const bigintNumberTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) =>
    value === undefined || value === null ? value : Number(value),
};
