import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AssetSummary, KeelApi } from '../api/client.js';
import { formatAssetId } from '../domain/asset-id.js';
import { display } from '../domain/decimal.js';
import { headerProvenance } from '../format/provenance.js';
import { guard, ok, READ_ONLY } from './result.js';
import { BANDS, FLAGS } from './schemas.js';

export function summaryRow(item: AssetSummary) {
  return {
    assetId: formatAssetId(item.asset),
    code: item.asset.code,
    issuer: item.asset.issuer ?? null,
    band: item.band,
    bandConfidence: item.bandConfidence,
    maxSafeCollateral: item.maxSafeCollateral ?? null,
    depth5PctBuySide: item.depth5PctBuySide ?? null,
    midPrice: item.midPrice ?? null,
    priceSource: item.priceSource ?? null,
    flags: item.flags,
    ledgerSeq: item.ledgerSeq,
  };
}

export function registerListAssets(server: McpServer, api: KeelApi) {
  server.registerTool(
    'list_assets',
    {
      title: 'List monitored Stellar assets',
      description:
        'Lists the Stellar assets Keel monitors with their risk band, band confidence, recommended maximum ' +
        'safe collateral size (USDC) and fired flags. Filter by band (e.g. CRITICAL) or by a single flag ' +
        '(e.g. MANIPULATION_CHEAP) to find risky collateral.',
      inputSchema: {
        band: z.enum(BANDS).optional().describe('Only assets in this band.'),
        hasFlag: z.enum(FLAGS).optional().describe('Only assets on which this flag fired.'),
        limit: z.number().int().min(1).max(200).optional().describe('Page size, default 50, max 200.'),
        offset: z.number().int().min(0).optional().describe('Rows to skip, for paging.'),
      },
      annotations: { title: 'List monitored Stellar assets', ...READ_ONLY },
    },
    guard(async (args) => {
      const { data, provenance } = await api.listAssets(args);
      const rows = data.items.map(summaryRow);
      const header =
        `${data.total} asset(s) match` +
        (args.band ? ` band ${args.band}` : '') +
        (args.hasFlag ? ` flag ${args.hasFlag}` : '') +
        `; showing ${rows.length} from offset ${data.offset}. Max safe collateral is in USDC.`;
      const lines = rows.map(
        (row) =>
          `- ${row.assetId}: ${row.band}${row.bandConfidence === 'partial' ? ' (partial)' : ''}, ` +
          `max safe ${row.maxSafeCollateral != null ? display(row.maxSafeCollateral) : 'n/a'}, ` +
          `flags [${row.flags.join(', ')}]`,
      );
      if (data.offset + rows.length < data.total) {
        lines.push(`More rows exist: call again with offset ${data.offset + rows.length}.`);
      }
      return ok([header, ...lines].join('\n'), {
        total: data.total,
        limit: data.limit,
        offset: data.offset,
        assets: rows,
        provenance: headerProvenance(provenance, api.baseUrl, { methodologyVersion: data.methodologyVersion }),
      });
    }),
  );
}
