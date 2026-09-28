import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { KeelApi } from './api/client.js';

export const REPORT_URL =
  'https://raw.githubusercontent.com/Keel-Official/keel-backend/main/docs/report/blend-february-2026.md';

export function registerResources(
  server: McpServer,
  api: KeelApi,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
) {
  server.registerResource(
    'methodology',
    'keel://methodology',
    {
      title: 'Keel methodology and thresholds',
      description: 'The active methodology version, its thresholds, and the calibration note, as JSON.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const { data } = await api.methodology();
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerResource(
    'blend-backtest-report',
    'keel://report/blend-february-2026',
    {
      title: 'Blend incident backtest report (February 2026)',
      description:
        'The open, reproducible report asking whether Keel could have warned about the USTRY oracle ' +
        'manipulation that drained a Blend pool on 22 February 2026. Markdown, fetched from the public repository.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const response = await fetchImpl(REPORT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Could not fetch the report from ${REPORT_URL}: HTTP ${response.status}`);
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await response.text() }] };
    },
  );
}
