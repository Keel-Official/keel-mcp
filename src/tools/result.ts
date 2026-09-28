import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { KeelApiError } from '../api/client.js';
import { InvalidAssetIdError } from '../domain/asset-id.js';

/** Every tool answers with prose for the model and the exact figures as JSON. */
export function ok(text: string, structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

const HINTS: Partial<Record<string, string>> = {
  LEDGER_NOT_AVAILABLE:
    'Keel has not reconstructed this ledger. Historical rows exist only where a replay ' +
    'was run; call get_risk_history with a source such as offers-implied and no range ' +
    'to list the ledgers that are stored.',
  ASSET_NOT_MONITORED:
    'Keel does not monitor this asset. Call find_asset or list_assets to see what is monitored.',
  INVALID_ASSET_ID: 'Use CODE:ISSUER or XLM. find_asset resolves a code to its issuers.',
  RATE_LIMITED: 'The public API is rate limited. Wait a minute before retrying.',
  HISTORICAL_UNAVAILABLE: 'The historical path is temporarily unavailable. Retry later.',
  NETWORK_ERROR: 'Check KEEL_API_URL and network access, then retry.',
};

export function fail(error: unknown): CallToolResult {
  let text: string;
  let structured: Record<string, unknown>;

  if (error instanceof KeelApiError) {
    const hint = HINTS[error.code];
    text = `Keel API error ${error.code} (HTTP ${error.status}): ${error.message}${hint ? `\n${hint}` : ''}`;
    structured = { error: { code: error.code, status: error.status, message: error.message, detail: error.detail ?? null } };
  } else if (error instanceof InvalidAssetIdError) {
    text = error.message;
    structured = { error: { code: 'INVALID_ASSET_ID', message: error.message } };
  } else {
    const message = error instanceof Error ? error.message : String(error);
    text = message;
    structured = { error: { code: 'INVALID_INPUT', message } };
  }

  return { isError: true, content: [{ type: 'text', text }], structuredContent: structured };
}

/** Wraps a handler so that no failure escapes as a protocol error. */
export function guard<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return fail(error);
    }
  };
}

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
