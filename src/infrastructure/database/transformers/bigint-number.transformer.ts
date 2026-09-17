import { ValueTransformer } from 'typeorm';

/**
 * Postgres `bigint` columns come back from `pg` as JS strings by default —
 * a real bigint can exceed `Number.MAX_SAFE_INTEGER`. Every money column
 * here stores cents for an Apple-reseller order, nowhere near that
 * ceiling, so converting to a real `number` matches the domain's own
 * `Money` value object (src/domain/value-objects/money.ts), which is
 * built on `number`, not `bigint` or `string`. Applied only to money
 * columns — `inventory_movements.id` stays a plain bigint/string, it is
 * not a quantity the domain does arithmetic on.
 */
export const bigintNumberTransformer: ValueTransformer = {
  to: (value?: number) => value,
  from: (value?: string) =>
    value === undefined || value === null ? value : Number(value),
};
