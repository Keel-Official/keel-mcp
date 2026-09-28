import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KeelApi } from '../api/client.js';
import { normalizeAssetId } from '../domain/asset-id.js';
import { provenanceLine, riskProvenance } from '../format/provenance.js';
import { renderRisk } from '../format/risk.js';
import { guard, ok, READ_ONLY } from './result.js';
import { assetId, quote } from './schemas.js';

export function registerAssetRisk(server: McpServer, api: KeelApi) {
  server.registerTool(
    'get_asset_risk',
    {
      title: 'Liquidity risk of a Stellar asset',
      description:
        'The full Keel risk reading for one asset: risk band and its confidence, fired and unevaluated flags, ' +
        'executable depth at +/-2%, 5% and 10% (SDEX order book plus AMM pools), recommended maximum safe ' +
        'collateral size with its liquidation and manipulation terms, holder concentration, volume to supply, ' +
        'and the last genuine trade. Pass ledger to read a historical reconstruction instead of the latest scan. ' +
        'Always quote the provenance line with the numbers.',
      inputSchema: {
        assetId,
        quote,
        ledger: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Optional ledger sequence for a historical reading. Only ledgers Keel has reconstructed exist ' +
              '(for example 61340263, the ledger of the February 2026 Blend exploit); others answer LEDGER_NOT_AVAILABLE.',
          ),
      },
      annotations: { title: 'Liquidity risk of a Stellar asset', ...READ_ONLY },
    },
    guard(async (args) => {
      const id = normalizeAssetId(args.assetId);
      const { data, provenance } = await api.depth(id, { quote: args.quote, ledger: args.ledger });
      const block = riskProvenance(data, provenance, api.baseUrl);
      return ok(`${renderRisk(data)}\n${provenanceLine(block)}`, { assetId: id, risk: data, provenance: block });
    }),
  );
}
