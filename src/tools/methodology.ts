import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { KeelApi } from '../api/client.js';
import { headerProvenance } from '../format/provenance.js';
import { guard, ok, READ_ONLY } from './result.js';

export function registerMethodology(server: McpServer, api: KeelApi) {
  server.registerTool(
    'get_methodology',
    {
      title: 'Keel methodology and thresholds',
      description:
        'The methodology version and every threshold Keel uses to fire flags and size collateral, with the ' +
        'link to the full documentation. The thresholds are chosen, not calibrated against a set of incidents; ' +
        'mention that when explaining why an asset got its band.',
      inputSchema: {},
      annotations: { title: 'Keel methodology and thresholds', ...READ_ONLY },
    },
    guard(async () => {
      const { data, provenance } = await api.methodology();
      const thresholds = Object.entries(data.thresholds ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `  ${key}: ${String(value)}`);
      const text = [
        `Methodology ${data.version}. Documentation: ${data.documentUrl}`,
        `Calibrated: ${data.calibrated ? 'yes' : 'no'}.${data.calibrationNote ? ` ${data.calibrationNote}` : ''}`,
        'Thresholds (keys ending in Pct are percent; liquidationHaircut and manipulationMargin are fractions):',
        ...thresholds,
      ].join('\n');
      return ok(text, {
        methodology: data,
        provenance: headerProvenance(provenance, api.baseUrl, { methodologyVersion: data.version }),
      });
    }),
  );
}
