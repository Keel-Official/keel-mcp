import { readFileSync } from 'node:fs';

import type { AssetRisk } from '../src/api/client.js';

/**
 * Fixtures are real responses from https://api.keels.app/v1, captured on
 * 28 September 2026 at ledger ~64657818. They are copied verbatim; a test that
 * needs a state the live API did not show builds it from these explicitly.
 */
export function loadRisk(name: 'ustry' | 'xlm'): AssetRisk {
  const file = new URL(`./fixtures/${name}-2026-09-28.json`, import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')) as AssetRisk;
}

export const USTRY = 'USTRY:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC';
// Two made-up issuers of one code, shaped like real accounts, for the ambiguity test.
export const USDY_A = `USDY:G${'A'.repeat(55)}`;
export const USDY_B = `USDY:G${'B'.repeat(55)}`;

type Route = (url: URL) => { status: number; body: unknown; headers?: Record<string, string> } | undefined;

/** A fetch that answers from a routing function and records every call. */
export function fakeFetch(route: Route) {
  const calls: { method: string; url: string }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({ method: request.method, url: request.url });
    const url = new URL(request.url);
    const answer = route(url) ?? { status: 404, body: { error: { code: 'ASSET_NOT_MONITORED', message: 'not in fake' } } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: {
        'content-type': 'application/json',
        'x-keel-methodology-version': '1.0.8-draft',
        'x-keel-staleness-seconds': '12',
        ...answer.headers,
      },
    });
  };
  return { fetch: fetchImpl as typeof globalThis.fetch, calls };
}

/** The decoded asset id of a /asset/{id}/... path, or undefined. */
export function assetFromPath(url: URL): string | undefined {
  const match = decodeURIComponent(url.pathname).match(/\/asset\/([^/]+)\//);
  return match?.[1];
}
