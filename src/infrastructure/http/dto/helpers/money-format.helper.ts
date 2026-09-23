/** Mechanical cents → dollars projection for response DTOs — no rounding decision beyond `toFixed(2)`. */
export function formatCentsAsDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
