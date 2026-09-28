import type { AssetRisk } from '../api/client.js';
import { D, type Dec } from './decimal.js';

/**
 * Comparisons between a size the caller supplies and figures the engine already
 * computed. Nothing here derives a new metric: no interpolation between depth
 * rungs, no score, no threshold of its own. Every judgement is "is this amount at
 * most that published figure", made in exact decimal arithmetic.
 */

export type CollateralVerdict = 'within' | 'exceeds' | 'unknown';
export type BindingTerm = 'liquidation' | 'manipulation' | null;

export interface CollateralCheck {
  verdict: CollateralVerdict;
  amount: string;
  maxSafeCollateral: string | null;
  /** amount / maxSafeCollateral, 6 decimal places. Null when the limit is null or zero. */
  ratio: string | null;
  /** maxSafeCollateral - amount. Negative when the amount exceeds the limit. */
  headroom: string | null;
  /** Which of the two published terms equals the minimum. */
  bindingTerm: BindingTerm;
  liquidationTerm: string | null;
  manipulationTerm: string | null;
  /** Plain sentences a model should repeat, not paraphrase away. */
  caveats: string[];
}

function bindingTerm(risk: AssetRisk): BindingTerm {
  const liquidation = risk.maxSafeCollateralLiquidation;
  const manipulation = risk.maxSafeCollateralManipulation;
  if (liquidation == null) return null;
  // Contract: a null manipulation term means the critical target is unreachable
  // through the orderbook, so the limit falls back to the liquidation term alone.
  if (manipulation == null) return 'liquidation';
  return new D(manipulation).lt(liquidation) ? 'manipulation' : 'liquidation';
}

export function commonCaveats(risk: AssetRisk): string[] {
  const caveats: string[] = [];
  if (risk.bandConfidence === 'partial') {
    caveats.push(
      `Band confidence is partial: ${risk.unevaluatedFlags.length} flag(s) could not be ` +
        `evaluated (${risk.unevaluatedFlags.join(', ')}). The band ${risk.band} is a floor ` +
        'and can only be worse than reported, never better.',
    );
  }
  if (risk.flags.includes('SPREAD_EXTREME')) {
    caveats.push(
      'SPREAD_EXTREME fired: the mid price is the midpoint of two unrelated prices, so the ' +
        'depth ladder and every figure derived from it lose their meaning.',
    );
  }
  if (risk.dataSource !== 'horizon' && risk.dataSource !== 'hubble') {
    caveats.push(
      `This row is a reconstruction (${risk.dataSource}), not a direct reading. ` +
        'Read its depth as a lower bound and its risk as an upper bound.',
    );
  }
  return caveats;
}

export function checkCollateral(risk: AssetRisk, amount: Dec): CollateralCheck {
  const max = risk.maxSafeCollateral;
  const base = {
    amount: amount.toString(),
    maxSafeCollateral: max ?? null,
    liquidationTerm: risk.maxSafeCollateralLiquidation ?? null,
    manipulationTerm: risk.maxSafeCollateralManipulation ?? null,
  };
  const caveats = commonCaveats(risk);

  if (max == null) {
    caveats.unshift(
      risk.priceSource === 'none'
        ? 'The asset has no executable price, so no safe collateral size can be computed. ' +
            'This is not a statement that the size is safe or unsafe.'
        : 'The engine did not publish a maximum safe collateral size for this reading. ' +
            'This is not a statement that the size is safe or unsafe.',
    );
    return { ...base, verdict: 'unknown', ratio: null, headroom: null, bindingTerm: null, caveats };
  }

  const limit = new D(max);
  const verdict: CollateralVerdict = amount.lte(limit) ? 'within' : 'exceeds';
  if (verdict === 'within' && risk.band !== 'LOW') {
    caveats.push(
      `The amount is within the size limit, but the asset is in band ${risk.band} with ` +
        `flags [${risk.flags.join(', ')}]. The size limit and the band answer different ` +
        'questions; read both.',
    );
  }
  return {
    ...base,
    verdict,
    ratio: limit.gt(0) ? amount.div(limit).toDecimalPlaces(6).toString() : null,
    headroom: limit.minus(amount).toString(),
    bindingTerm: bindingTerm(risk),
    caveats,
  };
}

export type TradeSide = 'buy' | 'sell';

export interface TradeRung {
  delta: number;
  depth: string;
  fits: boolean;
}

export interface TradeBracket {
  side: TradeSide;
  amount: string;
  /**
   * The smallest measured price move whose depth absorbs the whole amount, as a
   * relative shift (0.02 is 2 percent). Null when the amount exceeds the deepest
   * rung, or when there is no executable price.
   */
  withinDelta: number | null;
  exceedsMeasuredDepth: boolean;
  rungs: TradeRung[];
  summary: string;
  caveats: string[];
}

function pct(delta: number): string {
  return `${new D(delta).times(100).toString()}%`;
}

/**
 * Places an amount between the published rungs of the depth ladder. The answer is
 * a bracket ("moves the price by at most 5%"), never a point estimate, because a
 * point estimate would need an interpolation rule the methodology does not define.
 */
export function bracketTrade(risk: AssetRisk, side: TradeSide, amount: Dec): TradeBracket {
  const caveats = commonCaveats(risk);
  const rungs = [...risk.depth]
    .sort((a, b) => a.delta - b.delta)
    .map((point) => {
      const depth = side === 'buy' ? point.buySide : point.sellSide;
      return { delta: point.delta, depth, fits: amount.lte(depth) };
    });

  if (risk.priceSource === 'none') {
    return {
      side,
      amount: amount.toString(),
      withinDelta: null,
      exceedsMeasuredDepth: false,
      rungs,
      summary: 'The asset has no executable price, so no depth can be measured against it.',
      caveats,
    };
  }

  const first = rungs.find((rung) => rung.fits);
  const deepest = rungs.at(-1);
  const verb = side === 'buy' ? 'buying' : 'selling';
  const direction = side === 'buy' ? 'up' : 'down';
  const summary = first
    ? `${verb} ${amount.toString()} (quote notional) moves the marginal price ${direction} by at most ${pct(first.delta)}` +
      (rungs[0] && first !== rungs[0] ? `, and by more than ${pct(rungs[rungs.indexOf(first) - 1]!.delta)}` : '') +
      '.'
    : `${verb} ${amount.toString()} (quote notional) exceeds the depth measured at ${deepest ? pct(deepest.delta) : 'the deepest rung'}, ` +
      'so the price move is larger than anything the ladder measures.';

  return {
    side,
    amount: amount.toString(),
    withinDelta: first?.delta ?? null,
    exceedsMeasuredDepth: !first,
    rungs,
    summary,
    caveats,
  };
}
