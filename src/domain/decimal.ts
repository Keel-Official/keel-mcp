import { Decimal } from 'decimal.js';

/**
 * Every monetary value from the API is a decimal string with up to ~50 significant
 * digits. The engine never uses floats for them and neither does this server.
 * A dedicated constructor keeps the precision setting local to this package.
 */
export const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

const AMOUNT = /^\d+(\.\d+)?$/;

/** Parses a user-supplied positive amount, rejecting exponents and separators. */
export function parseAmount(value: string): Dec {
  const cleaned = value.trim().replace(/_/g, '');
  if (!AMOUNT.test(cleaned)) {
    throw new Error(
      `"${value}" is not a plain decimal amount. Write it like 500000 or 1250.75, ` +
        'without commas, currency symbols or exponents.',
    );
  }
  const amount = new D(cleaned);
  if (amount.lte(0)) throw new Error('The amount must be greater than zero.');
  return amount;
}

/** Human rendering for text output only. Structured output keeps the exact string. */
export function display(value: string | null | undefined, places = 2): string {
  if (value === null || value === undefined) return 'n/a';
  const fixed = new D(value).toFixed(places);
  const [whole, fraction] = fixed.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function displayPct(value: string | null | undefined, places = 2): string {
  return value === null || value === undefined ? 'n/a' : `${display(value, places)}%`;
}
