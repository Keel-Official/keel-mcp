/**
 * Blend V2 on Stellar mainnet.
 *
 * Addresses are from blend-capital/blend-utils `mainnet.contracts.json`. The
 * backstop V2 reward zone read EMPTY on 29 September 2026, so the known pools are
 * listed here rather than discovered from it; any other pool can still be audited
 * by passing its contract id.
 */
export const BLEND_BACKSTOP_V2 = 'CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7';

export const KNOWN_BLEND_POOLS = {
  YieldBlox: 'CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS',
  Fixed: 'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD',
} as const;

export type KnownPoolName = keyof typeof KNOWN_BLEND_POOLS;

export const DEFAULT_SOROBAN_RPC_URL = 'https://mainnet.sorobanrpc.com';

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** Accepts a known pool name (case-insensitive) or a pool contract id. */
export function resolvePoolId(value: string): string {
  const trimmed = value.trim();
  const named = Object.entries(KNOWN_BLEND_POOLS).find(([name]) => name.toLowerCase() === trimmed.toLowerCase());
  if (named) return named[1];
  if (CONTRACT_ID.test(trimmed)) return trimmed;
  throw new Error(
    `"${value}" is neither a known Blend pool (${Object.keys(KNOWN_BLEND_POOLS).join(', ')}) ` +
      'nor a pool contract id (C followed by 55 characters).',
  );
}

/**
 * Pool status codes, from blend-contracts-v2 `pool/src/pool/status.rs`. On-ice
 * disables new borrowing; frozen disables borrowing and supplying.
 */
export const POOL_STATUS: Record<number, string> = {
  0: 'admin active',
  1: 'active',
  2: 'admin on-ice (new borrowing disabled)',
  3: 'on-ice (new borrowing disabled)',
  4: 'admin frozen (borrowing and supplying disabled)',
  5: 'frozen (borrowing and supplying disabled)',
  6: 'setup',
};

export function poolStatusLabel(status: number): string {
  return POOL_STATUS[status] ?? `unknown status ${status}`;
}
