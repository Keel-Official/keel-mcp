import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { KeelApi } from '../api/client.js';
import { normalizeAssetId } from '../domain/asset-id.js';
import { checkCollateral } from '../domain/compare.js';
import { display, parseAmount } from '../domain/decimal.js';
import { provenanceLine, riskProvenance } from '../format/provenance.js';
import { bandLine, pairLabel } from '../format/risk.js';
import { guard, ok, READ_ONLY } from './result.js';
import { amount, assetId, quote } from './schemas.js';

export function registerCollateral(server: McpServer, api: KeelApi) {
  server.registerTool(
    'check_collateral_size',
    {
      title: 'Check a collateral size against Keel',
      description:
        "Compares a proposed collateral amount with Keel's recommended maximum safe collateral size for the " +
        'asset, and says which limit binds: liquidation (the book cannot absorb a forced sale) or manipulation ' +
        '(pushing the price up is cheaper than the loan it would unlock). Answers within, exceeds, or unknown. ' +
        'Unknown is not safe and not unsafe. This is a comparison with published figures, not a credit decision.',
      inputSchema: { assetId, amount, quote },
      annotations: { title: 'Check a collateral size against Keel', ...READ_ONLY },
    },
    guard(async (args) => {
      const id = normalizeAssetId(args.assetId);
      const size = parseAmount(args.amount);
      const { data, provenance } = await api.depth(id, { quote: args.quote });
      const check = checkCollateral(data, size);
      const block = riskProvenance(data, provenance, api.baseUrl);
      const unit = data.quote.code;

      const verdict =
        check.verdict === 'within'
          ? `WITHIN the recommended limit: ${display(check.amount)} ${unit} is ${check.ratio}x of ${display(check.maxSafeCollateral)} ${unit}, leaving ${display(check.headroom)} ${unit} of headroom.`
          : check.verdict === 'exceeds'
            ? `EXCEEDS the recommended limit: ${display(check.amount)} ${unit} is ${check.ratio ?? 'infinite'}x of ${display(check.maxSafeCollateral)} ${unit}, over by ${display(check.headroom?.replace(/^-/, ''))} ${unit}.`
            : `UNKNOWN: Keel publishes no maximum safe collateral size for this reading.`;

      const binding =
        check.bindingTerm === 'manipulation'
          ? `The binding limit is manipulation: pushing the price to the critical level through the order book (manipulationCriticalDelta in get_methodology) is what caps the size (term ${display(check.manipulationTerm)} ${unit}; liquidation term ${display(check.liquidationTerm)} ${unit}).`
          : check.bindingTerm === 'liquidation'
            ? `The binding limit is liquidation: the book can absorb only so much forced selling (term ${display(check.liquidationTerm)} ${unit}; manipulation term ${check.manipulationTerm != null ? `${display(check.manipulationTerm)} ${unit}` : 'not applied'}).`
            : '';

      const text = [
        `${pairLabel(data)}: ${verdict}`,
        binding,
        `${bandLine(data)}. Flags fired: ${data.flags.length ? data.flags.join(', ') : 'none'}.`,
        ...check.caveats.map((c) => `Note: ${c}`),
        provenanceLine(block),
      ]
        .filter(Boolean)
        .join('\n');

      return ok(text, {
        assetId: id,
        quote: data.quote,
        ...check,
        band: data.band,
        bandConfidence: data.bandConfidence,
        flags: data.flags,
        unevaluatedFlags: data.unevaluatedFlags,
        provenance: block,
      });
    }),
  );
}
