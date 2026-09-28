import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KeelApi } from '../api/client.js';
import { normalizeAssetId } from '../domain/asset-id.js';
import { bracketTrade } from '../domain/compare.js';
import { display, parseAmount } from '../domain/decimal.js';
import { provenanceLine, riskProvenance } from '../format/provenance.js';
import { deltaPct, pairLabel } from '../format/risk.js';
import { guard, ok, READ_ONLY } from './result.js';
import { amount, assetId, quote } from './schemas.js';

export function registerTradeDepth(server: McpServer, api: KeelApi) {
  server.registerTool(
    'estimate_trade_depth',
    {
      title: 'Price impact bracket for a trade size',
      description:
        'For traders and market makers: places a buy or sell size (in the quote asset, USDC) between the ' +
        "measured rungs of Keel's depth ladder, answering 'this moves the price by at most 2% / 5% / 10%' or " +
        "'this exceeds the measured depth'. It is a bracket, never a point estimate, because the methodology " +
        'defines no interpolation between rungs. Depth combines the SDEX order book and AMM pools.',
      inputSchema: {
        assetId,
        side: z.enum(['buy', 'sell']).describe('buy pushes the price up, sell pushes it down.'),
        amount,
        quote,
      },
      annotations: { title: 'Price impact bracket for a trade size', ...READ_ONLY },
    },
    guard(async (args) => {
      const id = normalizeAssetId(args.assetId);
      const size = parseAmount(args.amount);
      const { data, provenance } = await api.depth(id, { quote: args.quote });
      const bracket = bracketTrade(data, args.side, size);
      const block = riskProvenance(data, provenance, api.baseUrl);
      const unit = data.quote.code;

      const text = [
        `${pairLabel(data)}: ${bracket.summary}`,
        `Measured ${args.side} depth in ${unit}: ` +
          bracket.rungs.map((r) => `${deltaPct(r.delta)} ${display(r.depth)}${r.fits ? '' : ' (too small)'}`).join(', ') +
          '.',
        ...bracket.caveats.map((c) => `Note: ${c}`),
        'Depth is what rests on the book and in pools at this ledger; it can be withdrawn before a trade lands.',
        provenanceLine(block),
      ].join('\n');

      return ok(text, { assetId: id, quote: data.quote, ...bracket, provenance: block });
    }),
  );
}
