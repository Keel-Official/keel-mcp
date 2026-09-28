import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'assess_collateral',
    {
      title: 'Assess an asset as lending collateral',
      description:
        'A guided assessment of whether an asset can back a loan of a given size, using Keel figures only.',
      argsSchema: {
        assetId: z.string().describe('CODE:ISSUER or XLM. If only a code is known, it is resolved first.'),
        amount: z.string().describe('The collateral amount in USDC, e.g. "500000".'),
        protocol: z.string().optional().describe('Optional: the lending protocol or pool, e.g. "Blend".'),
      },
    },
    ({ assetId, amount, protocol }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Assess ${assetId} as collateral for ${amount} USDC${protocol ? ` on ${protocol}` : ''}, using the Keel tools.`,
              '',
              '1. If the asset id has no issuer, call find_asset. If several issuers match, stop and ask me which one.',
              '2. Call get_asset_risk for the full reading.',
              `3. Call check_collateral_size with amount ${amount}.`,
              '4. Call get_methodology if a threshold needs explaining.',
              '',
              'Then answer in this order: the verdict (within, exceeds, or unknown) and the ratio; which limit binds ',
              'and what that means for a lender; the band, its confidence, and every fired flag; every flag that was ',
              'NOT evaluated, stated as unchecked rather than clear; and any absent figure with the reason Keel gives.',
              '',
              'Rules: quote the ledger sequence and methodology version with the numbers. Never present a null as ',
              'zero or as safe. Say that the thresholds are chosen, not calibrated. Do not invent figures that Keel ',
              'did not return, and do not give a credit or investment decision: this is a liquidity reading.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
