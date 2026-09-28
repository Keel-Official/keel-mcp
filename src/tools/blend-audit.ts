import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { PoolAudit } from '../blend/audit.js';
import { KNOWN_BLEND_POOLS, resolvePoolId } from '../blend/pools.js';
import { renderAudits } from '../blend/render.js';
import { guard, ok, READ_ONLY } from './result.js';

export type BlendAuditRunner = (poolIds: string[], options: { withOraclePrices: boolean }) => Promise<PoolAudit[]>;

export function registerBlendAudit(server: McpServer, run: BlendAuditRunner) {
  server.registerTool(
    'audit_blend_pool',
    {
      title: 'Audit a Blend lending pool against Keel',
      description:
        "Reads a Blend V2 pool's collateral configuration from Stellar (collateral factor, supply cap, total " +
        "supplied, oracle price) and sets each collateral reserve beside Keel's maximum safe collateral size for " +
        'that asset. Says per reserve whether what the pool HOLDS and what it would ACCEPT exceed what Stellar ' +
        'liquidity can absorb. Omit pool to audit every known pool (YieldBlox, Fixed). Read-only; state the ' +
        'interpretation notes with any conclusion.',
      inputSchema: {
        pool: z
          .string()
          .optional()
          .describe(`A known pool name (${Object.keys(KNOWN_BLEND_POOLS).join(', ')}) or a Blend pool contract id. Omit for all known pools.`),
        withOraclePrices: z
          .boolean()
          .optional()
          .describe('Also read the pool oracle price per asset and compare it with Keel. Default true.'),
      },
      annotations: { title: 'Audit a Blend lending pool against Keel', ...READ_ONLY },
    },
    guard(async ({ pool, withOraclePrices }) => {
      const poolIds = pool ? [resolvePoolId(pool)] : Object.values(KNOWN_BLEND_POOLS);
      const audits = await run(poolIds, { withOraclePrices: withOraclePrices ?? true });
      return ok(renderAudits(audits), { audits });
    }),
  );
}
