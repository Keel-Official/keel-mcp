import type { AssetRisk } from '../api/client.js';
import { checkCollateral } from '../domain/compare.js';
import { D } from '../domain/decimal.js';
import type { BlendPoolSnapshot, BlendReserveSnapshot } from './load.js';

/**
 * Blend Pool Cap Audit: sets a Blend pool's collateral configuration beside the
 * figures Keel publishes for the same assets.
 *
 * Two comparisons per collateral reserve, both in USDC at Keel's executable mid
 * price and both against Keel's `maxSafeCollateral`:
 *   - the SUPPLY CAP, which is what the pool is configured to ACCEPT, and
 *   - the TOTAL SUPPLIED, which is what the pool HOLDS now.
 *
 * It is a comparison, not a new metric. It computes no threshold, no score and
 * no recommended cap of its own. Reading a pool-wide total against a figure the
 * methodology defines as a collateral SIZE is an interpretation, and the report
 * says so in `interpretation` rather than leaving it implicit.
 */

export type ReserveVerdict =
  /** Collateral factor is zero or the reserve is disabled: it cannot back a loan. */
  | 'not_collateral'
  /** Keel does not monitor this asset, so there is nothing to compare. */
  | 'not_monitored'
  /** Keel monitors it but publishes no safe size or no price for this reading. */
  | 'unknown'
  /** Both the cap and the current supply are within Keel's safe size. */
  | 'within'
  /** The current supply is within, but the cap lets it grow past the safe size. */
  | 'cap_exceeds'
  /** The current supply already exceeds the safe size. */
  | 'supplied_exceeds';

export interface SizeComparison {
  /** Asset units converted to USDC at Keel's mid price. */
  valueUsdc: string;
  verdict: 'within' | 'exceeds' | 'unknown';
  /** value / maxSafeCollateral. */
  ratio: string | null;
}

export interface KeelReading {
  assetId: string;
  band: AssetRisk['band'];
  bandConfidence: AssetRisk['bandConfidence'];
  flags: AssetRisk['flags'];
  unevaluatedFlags: AssetRisk['unevaluatedFlags'];
  maxSafeCollateral: string | null;
  midPrice: string | null;
  ledgerSeq: number;
  methodologyVersion: string;
}

export interface ReserveAudit extends BlendReserveSnapshot {
  keelAssetId: string | null;
  label: string;
  verdict: ReserveVerdict;
  keel: KeelReading | null;
  keelError: string | null;
  supplyCapCheck: SizeComparison | null;
  suppliedCheck: SizeComparison | null;
  /** |oracle - Keel mid| / Keel mid, in percent. The oracle's base is USD, Keel's is USDC. */
  oracleVsKeelDivergencePct: string | null;
  notes: string[];
}

export interface PoolAudit {
  pool: Omit<BlendPoolSnapshot, 'reserves'>;
  reserves: ReserveAudit[];
  summary: Record<ReserveVerdict, number>;
  interpretation: string[];
}

export type KeelLookup = Map<string, AssetRisk | { error: string }>;

export const INTERPRETATION = [
  "Keel's maxSafeCollateral is defined for one collateral SIZE. This audit reads a whole reserve (its " +
    'supply cap, and its total supplied) against it. For the liquidation term that is the natural reading, ' +
    'because liquidations of many positions sell into the same book. For the manipulation term it is ' +
    'conservative, because one attacker controls one position, not the whole reserve.',
  'Keel measures liquidity ON Stellar only: the SDEX order book and AMM pools against USDC. An asset with deep ' +
    'markets elsewhere (XLM on centralized exchanges, for example) reads as riskier here than its full market ' +
    'is. Read "exceeds" as "exceeds what Stellar itself can absorb", which is what an on-chain liquidation ' +
    'or an oracle that reads SDEX trades depends on.',
  'Values are converted at Keel\'s executable mid price in USDC. The Blend oracle price is shown beside it, ' +
    'in the oracle\'s own base (USD for Reflector); a large gap between the two is itself a signal, and was ' +
    'the signal in the February 2026 incident.',
];

function compare(risk: AssetRisk, units: string): SizeComparison {
  const value = new D(units).times(risk.midPrice!);
  const check = checkCollateral(risk, value);
  return {
    valueUsdc: value.toDecimalPlaces(7).toString(),
    verdict: check.verdict,
    ratio: check.ratio,
  };
}

function keelReading(assetId: string, risk: AssetRisk): KeelReading {
  return {
    assetId,
    band: risk.band,
    bandConfidence: risk.bandConfidence,
    flags: risk.flags,
    unevaluatedFlags: risk.unevaluatedFlags,
    maxSafeCollateral: risk.maxSafeCollateral ?? null,
    midPrice: risk.midPrice ?? null,
    ledgerSeq: risk.ledgerSeq,
    methodologyVersion: risk.methodologyVersion,
  };
}

export function auditReserve(
  reserve: BlendReserveSnapshot,
  keelAssetId: string | null,
  lookup: KeelLookup,
  quoteAssetId: string | null = null,
): ReserveAudit {
  const base = {
    ...reserve,
    keelAssetId,
    label: keelAssetId ?? quoteAssetId ?? reserve.assetContractId,
    keel: null as KeelReading | null,
    keelError: null as string | null,
    supplyCapCheck: null as SizeComparison | null,
    suppliedCheck: null as SizeComparison | null,
    oracleVsKeelDivergencePct: null as string | null,
    notes: [] as string[],
  };

  const entry = keelAssetId ? lookup.get(keelAssetId) : undefined;
  const risk = entry && !('error' in entry) ? entry : null;
  if (entry && 'error' in entry) base.keelError = entry.error;
  if (keelAssetId && risk) {
    base.keel = keelReading(keelAssetId, risk);
    if (reserve.oraclePrice && risk.midPrice && new D(risk.midPrice).gt(0)) {
      base.oracleVsKeelDivergencePct = new D(reserve.oraclePrice)
        .minus(risk.midPrice)
        .abs()
        .div(risk.midPrice)
        .times(100)
        .toDecimalPlaces(4)
        .toString();
    }
  }

  if (!reserve.enabled || new D(reserve.collateralFactor).isZero()) {
    base.notes.push(
      reserve.enabled
        ? 'Collateral factor is 0: the pool accepts supply of this asset but gives it no borrowing power.'
        : 'The reserve is disabled.',
    );
    return { ...base, verdict: 'not_collateral' };
  }
  if (!keelAssetId) {
    base.notes.push(
      quoteAssetId
        ? "This is Keel's unit of measurement (the quote asset). Keel does not measure it against itself, so there is no figure to compare with."
        : 'Keel does not monitor this asset, so there is no Keel figure to compare with.',
    );
    return { ...base, verdict: 'not_monitored' };
  }
  if (!risk) {
    base.notes.push(`Keel could not be read for ${keelAssetId}: ${base.keelError ?? 'no answer'}.`);
    return { ...base, verdict: 'unknown' };
  }
  if (risk.maxSafeCollateral == null || risk.midPrice == null) {
    base.notes.push(
      risk.priceSource === 'none'
        ? 'Keel finds no executable price for this asset on Stellar, so no safe size exists to compare with.'
        : 'Keel publishes no maximum safe collateral size for this reading.',
    );
    return { ...base, verdict: 'unknown' };
  }

  base.supplyCapCheck = compare(risk, reserve.supplyCap);
  base.suppliedCheck = compare(risk, reserve.totalSupplied);
  if (risk.bandConfidence === 'partial') {
    base.notes.push(`Keel band ${risk.band} is partial: ${risk.unevaluatedFlags.join(', ')} could not be evaluated.`);
  }

  const verdict: ReserveVerdict =
    base.suppliedCheck.verdict === 'exceeds'
      ? 'supplied_exceeds'
      : base.supplyCapCheck.verdict === 'exceeds'
        ? 'cap_exceeds'
        : 'within';
  return { ...base, verdict };
}

export function auditPool(
  snapshot: BlendPoolSnapshot,
  keelIds: Map<string, string>,
  lookup: KeelLookup,
  quoteIds: Map<string, string> = new Map(),
): PoolAudit {
  const { reserves, ...pool } = snapshot;
  const audited = reserves.map((reserve) =>
    auditReserve(
      reserve,
      keelIds.get(reserve.assetContractId) ?? null,
      lookup,
      quoteIds.get(reserve.assetContractId) ?? null,
    ),
  );
  const summary: Record<ReserveVerdict, number> = {
    supplied_exceeds: 0,
    cap_exceeds: 0,
    within: 0,
    unknown: 0,
    not_monitored: 0,
    not_collateral: 0,
  };
  for (const reserve of audited) summary[reserve.verdict] += 1;
  return { pool, reserves: audited, summary, interpretation: INTERPRETATION };
}
