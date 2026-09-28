#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DEFAULT_API_URL } from './api/client.js';
import { createKeelMcpServer, SERVER_VERSION } from './server.js';

// stdout carries the protocol. Everything meant for a human goes to stderr.
const log = (message: string) => process.stderr.write(`[keel-mcp] ${message}\n`);

function positiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    log(`${name}=${raw} is not a positive integer; using the default.`);
    return undefined;
  }
  return value;
}

async function main() {
  const baseUrl = process.env.KEEL_API_URL || DEFAULT_API_URL;
  const server = createKeelMcpServer({
    baseUrl,
    timeoutMs: positiveInt('KEEL_TIMEOUT_MS'),
    cacheTtlMs: positiveInt('KEEL_CACHE_TTL_MS'),
    sorobanRpcUrl: process.env.KEEL_SOROBAN_RPC_URL || undefined,
  });
  await server.connect(new StdioServerTransport());
  log(`v${SERVER_VERSION} ready on stdio, reading ${baseUrl}`);
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
