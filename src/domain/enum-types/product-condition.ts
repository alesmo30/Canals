/**
 * Mirrors the `product_condition` Postgres enum (data-model.dbml). Lives on
 * the product, not on inventory: a refurbished iPhone is a distinct SKU at
 * a distinct price, not the same product in a different state.
 */
export type ProductCondition = 'NEW' | 'REFURBISHED' | 'OPEN_BOX' | 'USED';
