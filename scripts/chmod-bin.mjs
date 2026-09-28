// tsc does not preserve the executable bit, and `npx keel-mcp` needs it.
import { chmodSync } from 'node:fs';

chmodSync(new URL('../dist/index.js', import.meta.url), 0o755);
