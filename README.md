# keel-mcp

[![npm](https://img.shields.io/npm/v/@keel-official/mcp)](https://www.npmjs.com/package/@keel-official/mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.Keel--Official%2Fkeel--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=keel-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Keel**, the liquidity
risk engine for Stellar. It lets an AI agent (Claude Desktop, Claude Code, Cursor, or any MCP
client) answer questions like these with Keel's own numbers:

- *"Is USTRY safe as collateral for a 500,000 USDC loan?"*
- *"How much AQUA can I sell before the price drops more than 5%?"*
- *"Which monitored assets are CRITICAL right now, and why?"*
- *"What did Keel see at ledger 61340263, the Blend exploit?"*

An oracle answers *what is the price*. Keel answers *what volume can that price actually
support*: executable depth from the SDEX order book and AMM pools at +/-2%, 5% and 10%, and the
largest collateral position that liquidity can safely back. This server exposes those figures
to agents. It reads the public API at `https://api.keels.app/v1`; the dashboard is at
[keels.app](https://keels.app).

## Install

Requires Node.js 20 or newer.

**Claude Code**

```bash
claude mcp add keel -- npx -y @keel-official/mcp
```

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "keel": {
      "command": "npx",
      "args": ["-y", "@keel-official/mcp"]
    }
  }
}
```

**From a checkout**, before the package is published:

```bash
npm install && npm run build
claude mcp add keel -- node /absolute/path/to/keel-mcp/dist/index.js
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `KEEL_API_URL` | `https://api.keels.app/v1` | Point at another deployment, or at the contract mock (`http://localhost:4010`) |
| `KEEL_TIMEOUT_MS` | `15000` | Per request timeout |
| `KEEL_CACHE_TTL_MS` | `60000` | Cache for the asset list and methodology. Scans run every 15 minutes |

## Tools

Every tool is read-only and returns two things: a short text answer for the model, and the
exact figures as structured JSON. Every answer carries its **provenance**: ledger sequence,
ledger close time, data source, methodology version, and how far behind the latest ledger the
data is.

| Tool | Answers |
|---|---|
| `keel_status` | Is the engine healthy, which ledger was scanned last, how many assets are monitored |
| `list_assets` | Monitored assets with band, confidence, max safe collateral and flags. Filter by `band` or `hasFlag` |
| `find_asset` | Resolves a code (`USDY`) to its `CODE:ISSUER` ids. Returns every issuer and picks none |
| `get_asset_risk` | The full reading for one asset, or a historical reconstruction with `ledger` |
| `check_collateral_size` | `within`, `exceeds` or `unknown` for a proposed collateral amount, the ratio, and which limit binds |
| `estimate_trade_depth` | Which measured rung (2%, 5%, 10%) absorbs a buy or sell size, or that it exceeds them all |
| `get_risk_history` | Band, depth and collateral over a ledger window or every stored reading of one source, with band changes |
| `compare_assets` | 2 to 10 assets side by side |
| `get_methodology` | Methodology version, every threshold, and the calibration note |

**Resources:** `keel://methodology` (JSON) and `keel://report/blend-february-2026`, the open
backtest report on the February 2026 Blend incident.

**Prompt:** `assess_collateral(assetId, amount, protocol?)` runs the tools in order and
asks for an answer that states the verdict, the binding limit, the band and its confidence,
every unevaluated flag, and the provenance.

## Example

> **You:** Is USTRY safe as collateral for a 500,000 USDC loan on Blend?
>
> **Agent** *(calls `find_asset`, `get_asset_risk`, `check_collateral_size`)*: No.
> 500,000 USDC is 7.23x Keel's recommended maximum of 69,120.49 USDC for
> `USTRY:GCRY...MYWC`. The binding limit is manipulation: pushing the price to the critical
> level through the order book caps the size well below the liquidation limit (133,252.90).
> USTRY is in band HIGH with partial confidence, so the band is a floor: HOLDER_CONCENTRATION_EXTREME
> fired (the largest holder has 91.46%), and NO_GENUINE_TRADE_30D, NO_GENUINE_TRADE_7D and
> WASH_TRADE_SUSPECTED could not be evaluated. Ledger 64657818, methodology 1.0.8-draft.
> Keel's thresholds are chosen, not calibrated.

*(Figures from the live API on 28 September 2026. Yours will differ.)*

## How it keeps answers honest

These rules come from Keel's engine and are enforced here as well:

1. **An asset is `CODE:ISSUER`, never a ticker.** Several issuers publish `USDY`. `find_asset`
   returns all of them and the agent is told to ask.
2. **Provenance on every answer.** Ledger and methodology version travel with every number,
   so anything an agent says can be checked against the API.
3. **Unknown is not safe.** A figure the engine could not compute is reported with the reason
   Keel gives, never as zero. `check_collateral_size` answers `unknown` rather than guessing.
4. **Unevaluated is not clear.** Flags that could not be checked are listed as such, and a
   `partial` band is described as a floor.
5. **No new methodology.** The server compares an amount with figures the engine published.
   `estimate_trade_depth` gives a bracket between measured rungs, not an interpolated point,
   because the methodology defines no interpolation.
6. **Exact decimals.** Every monetary comparison uses `decimal.js`, never floating point.

## What this server will never do

- Sign or submit a transaction, or hold a key. Keel is permanently read-only, and the test
  suite fails if `src/` issues anything but a GET.
- Publish a price feed or act as an oracle.
- Send alerts, webhooks or notifications.
- Make a credit or investment decision. It reports liquidity; the lender decides.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run inspect          # MCP Inspector against the built server
```

The API types in `src/api/schema.d.ts` are generated from `openapi/keel-openapi.yaml`, a copy of
the contract in [keel-backend](https://github.com/Keel-Official/keel-backend). Refresh both with
`npm run sync:contract` (it expects `../keel-backend`, or pass a path). A test fails when the
copied contract's version differs from `keel.contractVersion` in `package.json`, so drift is
visible rather than silent.

## License

MIT
