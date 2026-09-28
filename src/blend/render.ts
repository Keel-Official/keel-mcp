import { display } from '../domain/decimal.js';
import type { PoolAudit, ReserveAudit, ReserveVerdict } from './audit.js';

const VERDICT_TEXT: Record<ReserveVerdict, string> = {
  supplied_exceeds: 'SUPPLIED EXCEEDS safe size',
  cap_exceeds: 'CAP EXCEEDS safe size',
  within: 'within safe size',
  unknown: 'unknown',
  not_monitored: 'not monitored by Keel',
  not_collateral: 'not collateral',
};

function ratio(value: string | null | undefined): string {
  return value == null ? 'n/a' : `${display(value, 2)}x`;
}

function short(label: string): string {
  // CODE:GABC...WXYZ keeps a table readable; the structured output has the full id.
  const [code, issuer] = label.split(':');
  if (issuer) return `${code}:${issuer.slice(0, 4)}...${issuer.slice(-4)}`;
  return label.length > 20 ? `${label.slice(0, 6)}...${label.slice(-4)}` : label;
}

function row(r: ReserveAudit): string {
  const k = r.keel;
  return [
    short(r.label),
    display(r.collateralFactor, 2),
    `${display(r.totalSupplied)} (${ratio(r.suppliedCheck?.ratio)})`,
    `${display(r.supplyCap)} (${ratio(r.supplyCapCheck?.ratio)})`,
    k?.maxSafeCollateral != null ? display(k.maxSafeCollateral) : 'n/a',
    k ? `${k.band}${k.bandConfidence === 'partial' ? '*' : ''}` : '-',
    r.oracleVsKeelDivergencePct != null ? `${display(r.oracleVsKeelDivergencePct, 2)}%` : 'n/a',
    r.verdict === 'not_monitored' && r.keelAssetId === null && r.label !== r.assetContractId
      ? "Keel's quote asset"
      : VERDICT_TEXT[r.verdict],
  ].join(' | ');
}

export function renderPoolAudit(audit: PoolAudit): string {
  const { pool, reserves, summary } = audit;
  const lines = [
    `## Blend pool ${pool.name} (${pool.poolId})`,
    '',
    `Status: ${pool.statusLabel}. Oracle ${pool.oracle}. Read at ledger ${pool.latestLedger} on ${pool.loadedAt}.`,
    '',
    `Summary: ${summary.supplied_exceeds} supplied exceeds, ${summary.cap_exceeds} cap exceeds, ${summary.within} within, ` +
      `${summary.unknown} unknown, ${summary.not_monitored} not monitored, ${summary.not_collateral} not collateral.`,
    '',
    'Sizes are in asset units; the ratio beside each is its USDC value over Keel\'s max safe collateral. ' +
      'Band * = partial confidence (a floor).',
    '',
    'asset | c-factor | supplied (ratio) | supply cap (ratio) | Keel max safe (USDC) | Keel band | oracle vs Keel | verdict',
    '--- | --- | --- | --- | --- | --- | --- | ---',
    ...reserves.map(row),
  ];
  const noted = reserves.filter((r) => r.notes.length);
  if (noted.length) {
    lines.push('', 'Notes:');
    for (const r of noted) lines.push(`- ${short(r.label)}: ${r.notes.join(' ')}`);
  }
  const ledgers = [...new Set(reserves.flatMap((r) => (r.keel ? [r.keel.ledgerSeq] : [])))].sort((a, b) => a - b);
  const versions = [...new Set(reserves.flatMap((r) => (r.keel ? [r.keel.methodologyVersion] : [])))];
  if (ledgers.length) {
    lines.push('', `Keel readings: ledger(s) ${ledgers.join(', ')}, methodology ${versions.join(', ')}.`);
  }
  return lines.join('\n');
}

export function renderInterpretation(audit: PoolAudit): string {
  return ['How to read this:', ...audit.interpretation.map((p) => `- ${p}`)].join('\n');
}

export function renderAudits(audits: PoolAudit[]): string {
  if (audits.length === 0) return 'No pools audited.';
  return [...audits.map(renderPoolAudit), '', renderInterpretation(audits[0]!)].join('\n\n');
}
