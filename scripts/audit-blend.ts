// Blend Pool Cap Audit as a standalone report.
//
//   npm run audit:blend                     every known pool
//   npm run audit:blend -- YieldBlox        one pool, by name or contract id
//   npm run audit:blend -- --out reports    output directory (default: reports)
//
// Writes blend-audit-<timestamp>.md and .json. The JSON carries every exact figure
// and is what a reviewer re-checks the markdown against.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createKeelApi, DEFAULT_API_URL } from '../src/api/client.js';
import { KNOWN_BLEND_POOLS, resolvePoolId } from '../src/blend/pools.js';
import { renderAudits } from '../src/blend/render.js';
import { runBlendAudit } from '../src/blend/run.js';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1]! : 'reports';
const pools = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);
const poolIds = pools.length ? pools.map(resolvePoolId) : Object.values(KNOWN_BLEND_POOLS);

const apiUrl = process.env.KEEL_API_URL || DEFAULT_API_URL;
const rpcUrl = process.env.KEEL_SOROBAN_RPC_URL || undefined;
const api = createKeelApi({ baseUrl: apiUrl, timeoutMs: 30_000 });

const started = new Date();
const audits = await runBlendAudit(api, poolIds, { rpcUrl });

const stamp = started.toISOString().replace(/[:.]/g, '-');
const header = [
  '# Blend Pool Cap Audit',
  '',
  `Generated ${started.toISOString()} by keel-mcp from ${apiUrl} and Soroban RPC ${audits[0]?.pool.rpcUrl ?? ''}.`,
  'Read-only. Every figure is reproducible from the JSON file of the same name.',
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
const md = join(outDir, `blend-audit-${stamp}.md`);
const json = join(outDir, `blend-audit-${stamp}.json`);
writeFileSync(md, `${header}\n${renderAudits(audits)}\n`);
writeFileSync(json, `${JSON.stringify({ generatedAt: started.toISOString(), apiUrl, audits }, null, 2)}\n`);

console.log(renderAudits(audits));
console.error(`\nwrote ${md}\nwrote ${json}`);
