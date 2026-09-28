import type { AssetRisk, Provenance } from '../api/client.js';

/**
 * Keel's first non-negotiable rule is that every output carries its ledger and
 * its methodology version. This is the one shape every tool attaches, so an answer
 * an agent quotes can always be re-verified against the API.
 */
export interface ProvenanceBlock {
  ledgerSeq: number | null;
  ledgerClosedAt: string | null;
  computedAt: string | null;
  methodologyVersion: string | null;
  dataSource: string | null;
  /** Seconds behind the latest ledger, from `X-Keel-Staleness-Seconds`. */
  stalenessSeconds: number | null;
  apiUrl: string;
}

export function riskProvenance(risk: AssetRisk, headers: Provenance, apiUrl: string): ProvenanceBlock {
  return {
    ledgerSeq: risk.ledgerSeq,
    ledgerClosedAt: risk.ledgerClosedAt,
    computedAt: risk.computedAt,
    methodologyVersion: risk.methodologyVersion ?? headers.methodologyVersion,
    dataSource: risk.dataSource,
    stalenessSeconds: headers.stalenessSeconds,
    apiUrl,
  };
}

export function headerProvenance(
  headers: Provenance,
  apiUrl: string,
  extra: Partial<ProvenanceBlock> = {},
): ProvenanceBlock {
  return {
    ledgerSeq: null,
    ledgerClosedAt: null,
    computedAt: null,
    methodologyVersion: headers.methodologyVersion,
    dataSource: null,
    stalenessSeconds: headers.stalenessSeconds,
    apiUrl,
    ...extra,
  };
}

function age(seconds: number | null): string {
  if (seconds === null) return 'age not reported';
  if (seconds < 120) return `${seconds}s behind the latest ledger`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min behind the latest ledger`;
  return `${(seconds / 3600).toFixed(1)} h behind the latest ledger`;
}

export function provenanceLine(block: ProvenanceBlock): string {
  const parts = [
    block.ledgerSeq !== null ? `ledger ${block.ledgerSeq}` : null,
    block.ledgerClosedAt ? `closed ${block.ledgerClosedAt}` : null,
    block.dataSource ? `source ${block.dataSource}` : null,
    `methodology ${block.methodologyVersion ?? 'unknown'}`,
    age(block.stalenessSeconds),
  ].filter(Boolean);
  return `Provenance: ${parts.join(', ')}. Verify at ${block.apiUrl}.`;
}
