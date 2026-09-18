/** Last four digits of a PAN — the only part of the card this service ever stores or returns. */
export function cardLast4(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  return digits.slice(-4);
}
