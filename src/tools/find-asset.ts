import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KeelApi } from '../api/client.js';
import { headerProvenance } from '../format/provenance.js';
import { summaryRow } from './list-assets.js';
import { guard, ok, READ_ONLY } from './result.js';

export function registerFindAsset(server: McpServer, api: KeelApi) {
  server.registerTool(
    'find_asset',
    {
      title: 'Find a Keel asset id by code',
      description:
        'Resolves an asset code such as USDY or AQUA to the full CODE:ISSUER ids Keel monitors. When one code ' +
        'has several issuers, ALL of them are returned and none is chosen: ask the user which issuer they mean ' +
        'rather than picking one, because the same ticker from a different issuer is a different asset.',
      inputSchema: {
        code: z.string().min(1).max(12).describe('Asset code, case-insensitive, e.g. "usdy" or "XLM".'),
        issuer: z
          .string()
          .optional()
          .describe('Optional issuer account (G...) or a prefix of it, to narrow the matches.'),
      },
      annotations: { title: 'Find a Keel asset id by code', ...READ_ONLY },
    },
    guard(async ({ code, issuer }) => {
      const { data, provenance } = await api.allAssets();
      const wanted = code.trim().toUpperCase();
      const prefix = issuer?.trim().toUpperCase();
      const matches = data.items
        .filter((item) => item.asset.code.toUpperCase() === wanted)
        .filter((item) => !prefix || (item.asset.issuer ?? '').toUpperCase().startsWith(prefix))
        .map(summaryRow);

      let text: string;
      if (matches.length === 0) {
        text =
          `Keel does not monitor an asset with code ${wanted}${prefix ? ` and issuer ${prefix}...` : ''}. ` +
          `It monitors ${data.items.length} assets; call list_assets to browse them.`;
      } else if (matches.length === 1) {
        text = `One match: ${matches[0]!.assetId} (band ${matches[0]!.band}).`;
      } else {
        text = [
          `${matches.length} monitored assets use the code ${wanted}. They are different assets; ask which issuer is meant:`,
          ...matches.map((row) => `- ${row.assetId} (band ${row.band})`),
        ].join('\n');
      }
      return ok(text, {
        code: wanted,
        matches,
        ambiguous: matches.length > 1,
        provenance: headerProvenance(provenance, api.baseUrl, { methodologyVersion: data.methodologyVersion }),
      });
    }),
  );
}
