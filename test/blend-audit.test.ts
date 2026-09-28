import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { auditPool, auditReserve, type KeelLookup } from '../src/blend/audit.js';
import type { BlendPoolSnapshot, BlendReserveSnapshot } from '../src/blend/load.js';
import { KNOWN_BLEND_POOLS, poolStatusLabel, resolvePoolId } from '../src/blend/pools.js';
import { renderAudits } from '../src/blend/render.js';
import { D } from '../src/domain/decimal.js';
import { loadRisk, USTRY } from './helpers.js';

/**
 * The pool snapshots are the on-chain fields of Fixed and YieldBlox as read from
 * mainnet on 28 September 2026 (ledger 64666210). Keel readings come from the
 * 28 September fixtures, which are from a different ledger; the tests check the
 * audit's logic, not that the two readings are simultaneous.
 */
const pools = JSON.parse(
  readFileSync(new URL('./fixtures/blend-pools-2026-09-28.json', import.meta.url), 'utf8'),
) as BlendPoolSnapshot[];
const yieldBlox = pools.find((p) => p.name === 'YieldBlox')!;
const fixed = pools.find((p) => p.name === 'Fixed')!;

const XLM_SAC = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USTRY_SAC = 'CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR';
const USDC_SAC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const USDC = 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const xlm = loadRisk('xlm');
const ustry = loadRisk('ustry');
const keelIds = new Map([
  [XLM_SAC, 'XLM'],
  [USTRY_SAC, USTRY],
]);
const quoteIds = new Map([[USDC_SAC, USDC]]);
const lookup: KeelLookup = new Map();
lookup.set('XLM', xlm);
lookup.set(USTRY, ustry);

function reserve(overrides: Partial<BlendReserveSnapshot>): BlendReserveSnapshot {
  return {
    assetContractId: XLM_SAC,
    decimals: 7,
    collateralFactor: '0.75',
    enabled: true,
    supplyCap: '1000',
    totalSupplied: '100',
    totalBorrowed: '0',
    oraclePrice: null,
    oraclePriceTimestamp: null,
    ...overrides,
  };
}

describe('auditPool on the real YieldBlox pool', () => {
  const audit = auditPool(yieldBlox, keelIds, lookup, quoteIds);
  const byId = new Map(audit.reserves.map((r) => [r.assetContractId, r]));

  it('reports USTRY as not collateral: Blend set its collateral factor to 0', () => {
    const r = byId.get(USTRY_SAC)!;
    expect(r.collateralFactor).toBe('0');
    expect(r.verdict).toBe('not_collateral');
    expect(r.keel?.band).toBe('HIGH'); // Keel still reports on it
    expect(r.supplyCapCheck).toBeNull();
  });

  it("names USDC as Keel's quote asset rather than an unmonitored token", () => {
    const r = byId.get(USDC_SAC)!;
    expect(r.label).toBe(USDC);
    expect(r.verdict).toBe('not_monitored');
    expect(r.notes[0]).toContain('unit of measurement');
  });

  it('counts every reserve exactly once in the summary', () => {
    const total = Object.values(audit.summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(yieldBlox.reserves.length);
  });
});

describe('auditPool on the real Fixed pool', () => {
  it('finds the supplied XLM beyond what Stellar liquidity absorbs, with the exact ratio', () => {
    const audit = auditPool(fixed, keelIds, lookup, quoteIds);
    const r = audit.reserves.find((x) => x.assetContractId === XLM_SAC)!;
    expect(r.verdict).toBe('supplied_exceeds');
    // Recomputed independently from the two inputs, at 6 decimal places.
    const expected = new D(r.totalSupplied).times(xlm.midPrice!).div(xlm.maxSafeCollateral!).toDecimalPlaces(6);
    expect(r.suppliedCheck?.ratio).toBe(expected.toString());
    expect(audit.interpretation.some((p) => p.includes('ON Stellar only'))).toBe(true);
  });
});

describe('auditReserve verdicts', () => {
  const safe = xlm.maxSafeCollateral!; // ~130,936 USDC
  const mid = xlm.midPrice!; // 0.2092854 USDC per XLM

  it('within: both cap and supply below the safe size', () => {
    const units = new D(safe).div(mid).div(10).toFixed(7);
    expect(auditReserve(reserve({ supplyCap: units, totalSupplied: '1' }), 'XLM', lookup).verdict).toBe('within');
  });

  it('cap_exceeds: current supply is fine but the cap allows more than the safe size', () => {
    const r = auditReserve(reserve({ supplyCap: '100000000', totalSupplied: '1' }), 'XLM', lookup);
    expect(r.verdict).toBe('cap_exceeds');
    expect(r.suppliedCheck?.verdict).toBe('within');
  });

  it('treats a disabled reserve as not collateral', () => {
    expect(auditReserve(reserve({ enabled: false }), 'XLM', lookup).verdict).toBe('not_collateral');
  });

  it('answers unknown when Keel could not be read, and keeps the reason', () => {
    const failing: KeelLookup = new Map([['XLM', { error: 'RATE_LIMITED: slow down' }]]);
    const r = auditReserve(reserve({}), 'XLM', failing);
    expect(r.verdict).toBe('unknown');
    expect(r.keelError).toContain('RATE_LIMITED');
  });

  it('answers unknown, not within, when Keel publishes no safe size', () => {
    const noPrice: KeelLookup = new Map([['XLM', { ...xlm, priceSource: 'none' as const, midPrice: null, maxSafeCollateral: null }]]);
    const r = auditReserve(reserve({}), 'XLM', noPrice);
    expect(r.verdict).toBe('unknown');
    expect(r.notes[0]).toContain('no executable price');
  });

  it('computes the oracle divergence exactly and leaves it null without a price', () => {
    const r = auditReserve(reserve({ oraclePrice: '0.2' }), 'XLM', lookup);
    const expected = new D('0.2').minus(mid).abs().div(mid).times(100).toDecimalPlaces(4).toString();
    expect(r.oracleVsKeelDivergencePct).toBe(expected);
    expect(auditReserve(reserve({}), 'XLM', lookup).oracleVsKeelDivergencePct).toBeNull();
  });
});

describe('pools and rendering', () => {
  it('resolves pool names case-insensitively and accepts contract ids', () => {
    expect(resolvePoolId('yieldblox')).toBe(KNOWN_BLEND_POOLS.YieldBlox);
    expect(resolvePoolId(KNOWN_BLEND_POOLS.Fixed)).toBe(KNOWN_BLEND_POOLS.Fixed);
    expect(() => resolvePoolId('Aave')).toThrow(/known Blend pool/);
  });

  it('labels statuses from the Blend V2 contract', () => {
    expect(poolStatusLabel(3)).toContain('on-ice');
    expect(poolStatusLabel(42)).toBe('unknown status 42');
  });

  it('renders a table with a sorted ledger list and the interpretation notes', () => {
    const text = renderAudits([auditPool(fixed, keelIds, lookup, quoteIds), auditPool(yieldBlox, keelIds, lookup, quoteIds)]);
    expect(text).toContain('## Blend pool Fixed');
    expect(text).toContain("Keel's quote asset");
    expect(text).toContain('How to read this:');
    const ledgers = text.match(/ledger\(s\) ([\d, ]+),/)![1]!.split(', ').map(Number);
    expect([...ledgers].sort((a, b) => a - b)).toEqual(ledgers);
  });
});
