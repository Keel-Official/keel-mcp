import createClient from 'openapi-fetch';

import type { components, paths } from './schema.js';

/**
 * A thin, read-only wrapper over the public Keel API.
 *
 * The API is unauthenticated and has no endpoint that changes state. This module
 * only ever issues GET requests; the test suite checks that no other method
 * appears in `src/`.
 */

export type Schemas = components['schemas'];
export type AssetRisk = Schemas['AssetRisk'];
export type AssetSummary = Schemas['AssetSummary'];
export type AssetListResponse = Schemas['AssetListResponse'];
export type HistoryResponse = Schemas['HistoryResponse'];
export type Health = Schemas['Health'];
export type Methodology = Schemas['Methodology'];
export type Flag = Schemas['Flag'];
export type Band = Schemas['Band'];

export const DEFAULT_API_URL = 'https://api.keels.app/v1';
export const METHODOLOGY_VERSION_HEADER = 'x-keel-methodology-version';
export const STALENESS_SECONDS_HEADER = 'x-keel-staleness-seconds';

/** Provenance read from response headers, available even when a body is not. */
export interface Provenance {
  methodologyVersion: string | null;
  stalenessSeconds: number | null;
}

export interface KeelResult<T> {
  data: T;
  provenance: Provenance;
}

/** Error codes from the contract's `Error` schema, plus two raised locally. */
export type KeelErrorCode =
  | Schemas['Error']['error']['code']
  | 'NETWORK_ERROR'
  | 'UNEXPECTED_RESPONSE';

export class KeelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: KeelErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'KeelApiError';
  }
}

export interface KeelApiOptions {
  baseUrl?: string;
  /** Per request timeout. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** TTL for the asset list and the methodology. Defaults to 60 seconds. */
  cacheTtlMs?: number;
  /** Injection point for tests. */
  fetch?: typeof globalThis.fetch;
  /** Injection point for tests. */
  now?: () => number;
}

export interface ListAssetsQuery {
  band?: Band;
  hasFlag?: Flag;
  limit?: number;
  offset?: number;
}

export interface DepthQuery {
  quote?: string;
  ledger?: number;
}

export interface HistoryQuery {
  quote?: string;
  from?: number;
  to?: number;
  limit?: number;
  resolution?: 'hour' | 'day';
  source?: 'horizon' | 'hubble' | 'offers-implied' | 'trades-implied';
}

function readProvenance(response: Response): Provenance {
  const staleness = response.headers.get(STALENESS_SECONDS_HEADER);
  const parsed = staleness === null ? Number.NaN : Number(staleness);
  return {
    methodologyVersion: response.headers.get(METHODOLOGY_VERSION_HEADER),
    stalenessSeconds: Number.isFinite(parsed) ? parsed : null,
  };
}

function toApiError(status: number, error: unknown): KeelApiError {
  if (error && typeof error === 'object' && 'error' in error) {
    const body = (error as Schemas['Error']).error;
    if (body && typeof body.code === 'string' && typeof body.message === 'string') {
      return new KeelApiError(status, body.code, body.message, body.detail);
    }
  }
  if (status === 429) {
    return new KeelApiError(status, 'RATE_LIMITED', 'The Keel API rate limit was reached.');
  }
  const text = typeof error === 'string' ? error.slice(0, 200) : '';
  return new KeelApiError(
    status,
    'UNEXPECTED_RESPONSE',
    `The Keel API answered HTTP ${status} without a Keel error body.${text ? ` ${text}` : ''}`,
  );
}

export type KeelApi = ReturnType<typeof createKeelApi>;

export function createKeelApi(options: KeelApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const now = options.now ?? Date.now;

  const client = createClient<paths>({
    baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const cache = new Map<string, { expires: number; value: KeelResult<unknown> }>();

  async function cached<T>(key: string, load: () => Promise<KeelResult<T>>) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value as KeelResult<T>;
    const value = await load();
    cache.set(key, { expires: now() + cacheTtlMs, value });
    return value;
  }

  /** Runs one openapi-fetch call and turns every failure into a KeelApiError. */
  async function call<T>(
    run: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response: Response }>,
  ): Promise<KeelResult<T>> {
    let result: { data?: T; error?: unknown; response: Response };
    try {
      result = await run(AbortSignal.timeout(timeoutMs));
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.name === 'TimeoutError'
          ? `no answer within ${timeoutMs} ms`
          : cause instanceof Error
            ? cause.message
            : String(cause);
      throw new KeelApiError(0, 'NETWORK_ERROR', `Could not reach the Keel API at ${baseUrl}: ${reason}`);
    }
    const { data, error, response } = result;
    if (!response.ok || data === undefined) throw toApiError(response.status, error);
    return { data, provenance: readProvenance(response) };
  }

  return {
    baseUrl,

    health() {
      return call((signal) => client.GET('/health', { signal }));
    },

    methodology() {
      return cached('methodology', () => call((signal) => client.GET('/methodology', { signal })));
    },

    listAssets(query: ListAssetsQuery = {}) {
      return call((signal) => client.GET('/assets', { params: { query }, signal }));
    },

    /** Every monitored asset, paged through at the contract's maximum page size. */
    allAssets() {
      return cached('all-assets', async () => {
        const items: AssetSummary[] = [];
        let first: KeelResult<AssetListResponse> | undefined;
        for (let offset = 0; ; offset += 200) {
          const page = await call((signal) =>
            client.GET('/assets', { params: { query: { limit: 200, offset } }, signal }),
          );
          first ??= page;
          items.push(...page.data.items);
          if (page.data.items.length === 0 || items.length >= page.data.total) break;
        }
        return {
          data: { ...first!.data, items, limit: items.length, offset: 0 },
          provenance: first!.provenance,
        };
      });
    },

    depth(assetId: string, query: DepthQuery = {}) {
      return call((signal) =>
        client.GET('/asset/{assetId}/depth', {
          params: { path: { assetId }, query },
          signal,
        }),
      );
    },

    history(assetId: string, query: HistoryQuery = {}) {
      return call((signal) =>
        client.GET('/asset/{assetId}/history', {
          params: { path: { assetId }, query },
          signal,
        }),
      );
    },
  };
}
