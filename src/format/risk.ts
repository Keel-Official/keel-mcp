import type { AssetRisk } from '../api/client.js';
import { formatAssetId } from '../domain/asset-id.js';
import { D, display, displayPct } from '../domain/decimal.js';

/** 0.02 -> "2%", computed in decimal so 0.07 never renders as 7.000000000000001. */
export function deltaPct(delta: number): string {
  return `${new D(delta).times(100).toString()}%`;
}

/**
 * Text renderings for the model. Every absent figure is printed with the reason
 * the API gives for it, never as zero and never silently dropped: a missing holder
 * set and a holder set measured as safe are different answers.
 */

export function isReconstruction(risk: AssetRisk): boolean {
  return risk.dataSource !== 'horizon' && risk.dataSource !== 'hubble';
}

/**
 * The contract sends no supportingNotes on a reconstructed row: its reasons travel
 * in `warnings`. A bare "n/a" there would read as an unexplained gap.
 */
const RECONSTRUCTED = 'not measured on a reconstructed row; see the engine warnings';

function withReason(value: string, note: string | null | undefined, risk?: AssetRisk): string {
  const reason = note ?? (risk && isReconstruction(risk) ? RECONSTRUCTED : null);
  return reason ? `${value} (not available: ${reason})` : value;
}

export function pairLabel(risk: AssetRisk): string {
  return `${formatAssetId(risk.asset)} vs ${risk.quote.code}`;
}

export function bandLine(risk: AssetRisk): string {
  const confidence =
    risk.bandConfidence === 'partial'
      ? 'confidence partial, so this band is a floor and can only be worse'
      : 'confidence full';
  return `Band ${risk.band} (${confidence})`;
}

export function renderRisk(risk: AssetRisk): string {
  const notes = risk.supportingNotes ?? null;
  const quote = risk.quote.code;
  const lines: string[] = [];

  lines.push(`${pairLabel(risk)}: ${bandLine(risk)}.`);
  lines.push(
    `Price ${display(risk.midPrice, 7)} ${quote} from ${risk.priceSource}` +
      (risk.spreadPct != null ? `, spread ${displayPct(risk.spreadPct)}` : '') +
      (risk.poolSpotPrice != null ? `, pool spot ${display(risk.poolSpotPrice, 7)}` : '') +
      '.',
  );

  lines.push(`Executable depth in ${quote} (buy side / sell side, buy side split SDEX + AMM):`);
  for (const point of [...risk.depth].sort((a, b) => a.delta - b.delta)) {
    lines.push(
      `  +/-${deltaPct(point.delta)}: ${display(point.buySide)} / ${display(point.sellSide)}` +
        ` (SDEX ${display(point.fromSdex)} + AMM ${display(point.fromAmm)})`,
    );
  }

  if (risk.maxSafeCollateral != null) {
    lines.push(
      `Max safe collateral: ${display(risk.maxSafeCollateral)} ${quote}` +
        ` (liquidation term ${display(risk.maxSafeCollateralLiquidation)},` +
        ` manipulation term ${risk.maxSafeCollateralManipulation != null ? display(risk.maxSafeCollateralManipulation) : 'not applied, critical target unreachable through the book'}).`,
    );
  } else {
    lines.push('Max safe collateral: not computed for this reading.');
  }

  lines.push(`Flags fired: ${risk.flags.length ? risk.flags.join(', ') : 'none'}.`);
  if (risk.unevaluatedFlags.length) {
    lines.push(`Flags NOT evaluated (not the same as clear): ${risk.unevaluatedFlags.join(', ')}.`);
  }

  const holders =
    risk.holderTop1Pct != null
      ? `largest holder ${displayPct(risk.holderTop1Pct)}, top ten ${displayPct(risk.holderTop10Pct)}, HHI ${display(risk.holderHhi, 4)}`
      : withReason('n/a', notes?.holders, risk);
  lines.push(`Holders: ${holders}.`);

  const v2s = risk.volumeToSupply
    ? `1d ${display(risk.volumeToSupply.d1, 6)}, 7d ${display(risk.volumeToSupply.d7, 6)}, 30d ${display(risk.volumeToSupply.d30, 6)}`
    : withReason('n/a', notes?.volumeToSupply, risk);
  lines.push(`Volume to supply: ${v2s}.`);

  const excluded =
    risk.tradesExcludedPct != null ? displayPct(risk.tradesExcludedPct) : withReason('n/a', notes?.tradesExcludedPct, risk);
  lines.push(`30 day volume excluded as non-genuine: ${excluded}.`);

  const lastTrade = risk.lastGenuineTrade
    ? `${risk.lastGenuineTrade.at} (ledger ${risk.lastGenuineTrade.ledgerSeq})`
    : withReason('none found', notes?.lastGenuineTrade, risk);
  lines.push(`Last genuine trade: ${lastTrade}.`);

  if (risk.warnings.length) {
    lines.push('Engine warnings:');
    for (const warning of risk.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}
