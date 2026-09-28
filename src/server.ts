import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createKeelApi, type KeelApi, type KeelApiOptions } from './api/client.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerAssetRisk } from './tools/asset-risk.js';
import { registerCollateral } from './tools/collateral.js';
import { registerCompare } from './tools/compare.js';
import { registerFindAsset } from './tools/find-asset.js';
import { registerHistory } from './tools/history.js';
import { registerListAssets } from './tools/list-assets.js';
import { registerMethodology } from './tools/methodology.js';
import { registerStatus } from './tools/status.js';
import { registerTradeDepth } from './tools/trade-depth.js';

export const SERVER_NAME = 'keel';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `Keel measures the executable liquidity behind Stellar asset prices: how much volume the SDEX order book and AMM pools can absorb at +/-2%, 5% and 10%, and the largest collateral position that liquidity can safely support.

Use it to judge an asset as lending collateral (check_collateral_size), to size a trade (estimate_trade_depth), to screen assets (list_assets, compare_assets), and to look back at a ledger (get_asset_risk with ledger, get_risk_history).

Rules for answers built on these tools:
- An asset is CODE:ISSUER, never a bare ticker. Resolve codes with find_asset and ask when several issuers match.
- Quote the provenance (ledger sequence and methodology version) with every number.
- A flag listed as not evaluated is unchecked, not clear. A partial band is a floor.
- A null figure is unknown, never zero and never safe; give the reason Keel supplies.
- Thresholds are chosen, not calibrated. This is a liquidity reading, not a credit or investment decision.
- Keel is read-only. It never signs or submits transactions and publishes no price feed.`;

export interface KeelMcpOptions extends KeelApiOptions {
  api?: KeelApi;
}

export function createKeelMcpServer(options: KeelMcpOptions = {}) {
  const api = options.api ?? createKeelApi(options);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerStatus(server, api);
  registerListAssets(server, api);
  registerFindAsset(server, api);
  registerAssetRisk(server, api);
  registerCollateral(server, api);
  registerTradeDepth(server, api);
  registerHistory(server, api);
  registerCompare(server, api);
  registerMethodology(server, api);
  registerResources(server, api, options.fetch);
  registerPrompts(server);

  return server;
}
