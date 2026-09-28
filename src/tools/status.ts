import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { KeelApi } from '../api/client.js';
import { headerProvenance } from '../format/provenance.js';
import { guard, ok, READ_ONLY } from './result.js';

export function registerStatus(server: McpServer, api: KeelApi) {
  server.registerTool(
    'keel_status',
    {
      title: 'Keel service status',
      description:
        'Whether the Keel engine is healthy, the ledger of its latest scan, how many Stellar assets it ' +
        'monitors, and the methodology version its numbers follow. Call this first when freshness matters.',
      inputSchema: {},
      annotations: { title: 'Keel service status', ...READ_ONLY },
    },
    guard(async () => {
      const { data, provenance } = await api.health();
      const text = [
        `Keel is ${data.status}.`,
        `Latest scan: ledger ${data.latestScanLedgerSeq ?? 'n/a'} at ${data.latestScanAt ?? 'n/a'}.`,
        `Assets monitored: ${data.assetsMonitored ?? 'n/a'}. Methodology ${data.methodologyVersion}.`,
        `Historical replay available: ${data.historicalAvailable === false ? 'no' : 'yes'}. Build ${data.buildRevision ?? 'unknown'}.`,
        data.status === 'degraded'
          ? 'Degraded means the latest scan is late or incomplete: treat current figures with extra care.'
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      return ok(text, {
        health: data,
        provenance: headerProvenance(provenance, api.baseUrl, {
          ledgerSeq: data.latestScanLedgerSeq ?? null,
          methodologyVersion: data.methodologyVersion,
        }),
      });
    }),
  );
}
