import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KeelApi } from '../api/client.js';
import { normalizeAssetId } from '../domain/asset-id.js';
import { display } from '../domain/decimal.js';
import { riskProvenance } from '../format/provenance.js';
import { fail, guard, ok, READ_ONLY } from './result.js';
import { assetId } from './schemas.js';

export function registerCompare(server: McpServer, api: KeelApi) {
  server.registerTool(
    'compare_assets',
    {
      title: 'Compare Stellar assets side by side',
      description:
        'Side-by-side comparison of 2 to 10 assets: band and confidence, max safe collateral, depth at 5% on ' +
        'both sides, and fired flags, each with its own ledger. Useful for choosing between collateral ' +
        'candidates. Figures are all in USDC.',
      inputSchema: {
        assetIds: z.array(assetId).min(2).max(10).describe('The assets to compare, as CODE:ISSUER or XLM.'),
      },
      annotations: { title: 'Compare Stellar assets side by side', ...READ_ONLY },
    },
    guard(async ({ assetIds }) => {
      const ids = assetIds.map(normalizeAssetId);
      const settled = await Promise.allSettled(ids.map((id) => api.depth(id)));

      const rows = settled.map((result, i) => {
        const id = ids[i]!;
        if (result.status === 'rejected') {
          const error = fail(result.reason).structuredContent?.error;
          return { assetId: id, error };
        }
        const { data, provenance } = result.value;
        const depth5 = data.depth.find((p) => p.delta === 0.05);
        return {
          assetId: id,
          band: data.band,
          bandConfidence: data.bandConfidence,
          maxSafeCollateral: data.maxSafeCollateral ?? null,
          depth5PctBuySide: depth5?.buySide ?? null,
          depth5PctSellSide: depth5?.sellSide ?? null,
          flags: data.flags,
          unevaluatedFlags: data.unevaluatedFlags,
          provenance: riskProvenance(data, provenance, api.baseUrl),
        };
      });

      const lines = ['asset | band | max safe collateral | depth 5% buy / sell | flags | ledger'];
      for (const row of rows) {
        if ('error' in row) {
          lines.push(`${row.assetId} | error: ${JSON.stringify(row.error)}`);
          continue;
        }
        lines.push(
          `${row.assetId} | ${row.band}${row.bandConfidence === 'partial' ? ' (partial)' : ''} | ` +
            `${display(row.maxSafeCollateral)} | ${display(row.depth5PctBuySide)} / ${display(row.depth5PctSellSide)} | ` +
            `${row.flags.join(', ') || 'none'} | ${row.provenance.ledgerSeq}`,
        );
      }
      lines.push(
        'A partial band is a floor. Methodology and exact figures are in the structured result; ' +
          'call get_asset_risk for the full reading of any one asset.',
      );
      return ok(lines.join('\n'), { assets: rows });
    }),
  );
}
