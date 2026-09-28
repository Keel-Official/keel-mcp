import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KeelApi } from '../api/client.js';
import { normalizeAssetId } from '../domain/asset-id.js';
import { display } from '../domain/decimal.js';
import { headerProvenance, provenanceLine } from '../format/provenance.js';
import { guard, ok, READ_ONLY } from './result.js';
import { assetId, quote, SOURCES } from './schemas.js';

export function registerHistory(server: McpServer, api: KeelApi) {
  server.registerTool(
    'get_risk_history',
    {
      title: 'Risk history of a Stellar asset',
      description:
        'A time series of band, flags, depth and max safe collateral for one asset, from ONE data source. ' +
        'Give from and to (ledger sequences, at most 90 days apart) for a window, or omit both to list every ' +
        'stored reading of that source. Reconstructions such as the February 2026 USTRY series live under ' +
        'source offers-implied and are reachable only with both bounds omitted. Band changes are summarised.',
      inputSchema: {
        assetId,
        quote,
        source: z
          .enum(SOURCES)
          .optional()
          .describe(
            'horizon (default) and hubble are direct readings; offers-implied and trades-implied are ' +
              'reconstructions, and trades-implied is a lower bound.',
          ),
        from: z.number().int().min(1).optional().describe('First ledger, inclusive. Requires to.'),
        to: z.number().int().min(1).optional().describe('Last ledger, inclusive. Requires from.'),
        resolution: z.enum(['hour', 'day']).optional().describe('Bucket size for a windowed request. Default day.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe('Most points to return. Default 200 here (the API allows up to 5000).'),
      },
      annotations: { title: 'Risk history of a Stellar asset', ...READ_ONLY },
    },
    guard(async (args) => {
      if ((args.from === undefined) !== (args.to === undefined)) {
        throw new Error(
          'Give both from and to for a window, or neither to list the stored readings. One bound alone is ' +
            'neither question, and the API answers it with INVALID_RANGE.',
        );
      }
      const id = normalizeAssetId(args.assetId);
      const { data, provenance } = await api.history(id, {
        quote: args.quote,
        source: args.source,
        from: args.from,
        to: args.to,
        resolution: args.resolution,
        limit: args.limit ?? 200,
      });

      const points = data.points;
      const transitions = points.flatMap((point, i) => {
        const previous = points[i - 1];
        return previous && previous.band !== point.band
          ? [{ ledgerSeq: point.ledgerSeq, at: point.ledgerClosedAt, from: previous.band, to: point.band }]
          : [];
      });

      const lines = [
        `${id}: ${points.length} point(s) from source ${data.dataSource}, ledgers ${data.from} to ${data.to}` +
          (args.from === undefined ? ' (every stored reading of this source)' : `, resolution ${data.resolution}`) +
          '.',
      ];
      if (points.length === 0) {
        lines.push(
          args.from !== undefined && data.dataSource !== 'horizon'
            ? 'No points in this window. Reconstructions sit where the replay ran; omit from and to to list them.'
            : 'No points stored for this source.',
        );
      } else {
        const first = points[0]!;
        const last = points.at(-1)!;
        lines.push(
          `First: ledger ${first.ledgerSeq} (${first.ledgerClosedAt}) band ${first.band}, max safe ${display(first.maxSafeCollateral)}.`,
          `Last: ledger ${last.ledgerSeq} (${last.ledgerClosedAt}) band ${last.band}, max safe ${display(last.maxSafeCollateral)}.`,
          transitions.length
            ? `Band changes: ${transitions.map((t) => `${t.from} -> ${t.to} at ledger ${t.ledgerSeq} (${t.at})`).join('; ')}.`
            : 'The band did not change across these points.',
        );
      }
      if (data.gaps?.length) {
        lines.push(
          `Gaps with no data (do not interpolate across them): ${data.gaps.map((g) => `${g.from}-${g.to} (${g.reason})`).join('; ')}.`,
        );
      }
      const block = headerProvenance(provenance, api.baseUrl, {
        methodologyVersion: data.methodologyVersion,
        dataSource: data.dataSource,
      });
      lines.push(provenanceLine(block));

      return ok(lines.join('\n'), { assetId: id, history: data, bandTransitions: transitions, provenance: block });
    }),
  );
}
