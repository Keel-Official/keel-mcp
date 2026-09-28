import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createKeelMcpServer } from '../src/server.js';
import { assetFromPath, fakeFetch, loadRisk, USDY_A, USDY_B, USTRY } from './helpers.js';

const ustry = loadRisk('ustry');
const xlm = loadRisk('xlm');

function summary(risk: typeof ustry) {
  return {
    asset: risk.asset,
    quote: risk.quote,
    band: risk.band,
    bandConfidence: risk.bandConfidence,
    flags: risk.flags,
    ledgerSeq: risk.ledgerSeq,
    maxSafeCollateral: risk.maxSafeCollateral,
  };
}

function usdy(id: string) {
  const [code, issuer] = id.split(':');
  return { ...summary(ustry), asset: { code: code!, type: 'credit_alphanum4', issuer: issuer! } };
}

const assets = [summary(ustry), summary(xlm), usdy(USDY_A), usdy(USDY_B)];

function route(url: URL) {
  const path = decodeURIComponent(url.pathname);
  if (path.endsWith('/health')) {
    return {
      status: 200,
      body: { status: 'ok', latestScanLedgerSeq: 64657803, latestScanAt: '2026-09-28T05:54:50Z', assetsMonitored: 85, methodologyVersion: '1.0.8-draft', historicalAvailable: true, buildRevision: '5d230a5' },
    };
  }
  if (path.endsWith('/assets')) {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    return {
      status: 200,
      body: { items: assets.slice(offset, offset + limit), total: assets.length, limit, offset, methodologyVersion: '1.0.8-draft' },
    };
  }
  const asset = assetFromPath(url);
  if (path.endsWith('/depth')) {
    if (url.searchParams.get('ledger') === '61147341') {
      return { status: 404, body: { error: { code: 'LEDGER_NOT_AVAILABLE', message: 'Ledger 61147341 is not available.' } } };
    }
    if (url.searchParams.get('ledger') === '61340263' && asset === USTRY) {
      // Shaped like the live reconstruction: no supportingNotes, reasons in warnings.
      return {
        status: 200,
        body: {
          ...ustry, ledgerSeq: 61340263, dataSource: 'offers-implied', supportingNotes: null,
          holderTop1Pct: null, holderTop10Pct: null, holderHhi: null,
        },
        headers: { 'x-keel-staleness-seconds': '0' },
      };
    }
    if (asset === USTRY) return { status: 200, body: ustry };
    if (asset === 'XLM') return { status: 200, body: xlm };
  }
  if (path.endsWith('/history') && asset === USTRY) {
    return {
      status: 200,
      body: {
        asset: ustry.asset, quote: ustry.quote, from: 61340172, to: 61340263, resolution: 'day', methodologyVersion: '1.0.8-draft', dataSource: 'offers-implied',
        points: [
          { ledgerSeq: 61340172, ledgerClosedAt: '2026-02-22T00:00:00Z', band: 'LOW', flags: [], maxSafeCollateral: '100' },
          { ledgerSeq: 61340263, ledgerClosedAt: '2026-02-22T00:09:00Z', band: 'CRITICAL', flags: ['MANIPULATION_CHEAP'], maxSafeCollateral: '0' },
        ],
      },
    };
  }
  return undefined;
}

let client: Client;
let calls: { method: string; url: string }[];
let blendCalls: string[][];

beforeEach(async () => {
  const fake = fakeFetch(route);
  calls = fake.calls;
  blendCalls = [];
  const server = createKeelMcpServer({
    baseUrl: 'https://api.test/v1',
    fetch: fake.fetch,
    blendAudit: async (poolIds) => {
      blendCalls.push(poolIds);
      return poolIds.map((poolId) => ({
        pool: { poolId, name: 'TestPool', status: 3, statusLabel: 'on-ice (new borrowing disabled)', oracle: 'C', latestLedger: 1, loadedAt: 't', rpcUrl: 'r' },
        reserves: [],
        summary: { supplied_exceeds: 0, cap_exceeds: 0, within: 0, unknown: 0, not_monitored: 0, not_collateral: 0 },
        interpretation: ['ON Stellar only'],
      }));
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { result, text, data: result.structuredContent as Record<string, any> };
}

describe('keel-mcp server', () => {
  it('lists the ten read-only tools, one resource pair and the prompt', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'audit_blend_pool', 'check_collateral_size', 'compare_assets', 'estimate_trade_depth', 'find_asset', 'get_asset_risk',
      'get_methodology', 'get_risk_history', 'keel_status', 'list_assets',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['keel://methodology', 'keel://report/blend-february-2026']);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['assess_collateral']);
  });

  it('get_asset_risk quotes the ledger and methodology with the numbers', async () => {
    const { result, text, data } = await call('get_asset_risk', { assetId: USTRY });
    expect(result.isError).toBeFalsy();
    expect(text).toContain('Band HIGH');
    expect(text).toContain('ledger 64657818');
    expect(text).toContain('methodology 1.0.8-draft');
    expect(text).toContain('12s behind');
    expect(text).toContain('NOT evaluated');
    expect(data.provenance.ledgerSeq).toBe(64657818);
    expect(data.risk.maxSafeCollateral).toBe('69120.494708158027884399913875');
  });

  it('get_asset_risk carries the reason for an absent figure instead of a zero', async () => {
    const { text } = await call('get_asset_risk', { assetId: 'xlm' });
    expect(text).toContain('native asset and has no trustlines');
  });

  it('get_asset_risk explains absent figures on a reconstruction and drops the live age', async () => {
    const { text } = await call('get_asset_risk', { assetId: USTRY, ledger: 61340263 });
    expect(text).toContain('+/-2%: ');
    expect(text).toContain('Holders: n/a (not available: not measured on a reconstructed row');
    expect(text).toContain('a historical row, not a live reading');
    expect(text).not.toContain('behind the latest ledger');
  });

  it('get_asset_risk turns an unreconstructed ledger into a clear error', async () => {
    const { result, text, data } = await call('get_asset_risk', { assetId: USTRY, ledger: 61147341 });
    expect(result.isError).toBe(true);
    expect(data.error.code).toBe('LEDGER_NOT_AVAILABLE');
    expect(text).toContain('has not reconstructed this ledger');
  });

  it('check_collateral_size judges 500000 USDC of USTRY as exceeding the limit', async () => {
    const { text, data } = await call('check_collateral_size', { assetId: USTRY, amount: '500000' });
    expect(data.verdict).toBe('exceeds');
    expect(data.bindingTerm).toBe('manipulation');
    expect(text).toContain('EXCEEDS');
    expect(text).toContain('69,120.49');
  });

  it('check_collateral_size rejects a malformed amount without calling the API', async () => {
    const before = calls.length;
    const { result } = await call('check_collateral_size', { assetId: USTRY, amount: '1e6' });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('estimate_trade_depth answers with a bracket', async () => {
    const { data } = await call('estimate_trade_depth', { assetId: USTRY, side: 'sell', amount: '266500' });
    expect(data.withinDelta).toBe(0.05);
  });

  it('find_asset returns every issuer of an ambiguous code and picks none', async () => {
    const { text, data } = await call('find_asset', { code: 'usdy' });
    expect(data.ambiguous).toBe(true);
    expect(data.matches.map((m: { assetId: string }) => m.assetId).sort()).toEqual([USDY_A, USDY_B].sort());
    expect(text).toContain('ask which issuer');
  });

  it('get_risk_history rejects one bound alone before calling the API', async () => {
    const before = calls.length;
    const { result } = await call('get_risk_history', { assetId: USTRY, from: 1 });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('get_risk_history summarises band changes', async () => {
    const { text, data } = await call('get_risk_history', { assetId: USTRY, source: 'offers-implied' });
    expect(data.bandTransitions).toHaveLength(1);
    expect(text).toContain('LOW -> CRITICAL at ledger 61340263');
  });

  it('compare_assets reports a failing asset without failing the whole comparison', async () => {
    const { result, data } = await call('compare_assets', { assetIds: [USTRY, 'XLM', USDY_A] });
    expect(result.isError).toBeFalsy();
    expect(data.assets).toHaveLength(3);
    expect(data.assets[2].error.code).toBe('ASSET_NOT_MONITORED');
  });

  it('audit_blend_pool audits every known pool by default and one pool by name', async () => {
    const all = await call('audit_blend_pool');
    expect(all.result.isError).toBeFalsy();
    expect(blendCalls[0]).toHaveLength(2);
    expect(all.text).toContain('## Blend pool TestPool');
    await call('audit_blend_pool', { pool: 'yieldblox' });
    expect(blendCalls[1]).toEqual(['CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS']);
  });

  it('audit_blend_pool rejects an unknown pool without reading the chain', async () => {
    const { result } = await call('audit_blend_pool', { pool: 'Aave' });
    expect(result.isError).toBe(true);
    expect(blendCalls).toHaveLength(0);
  });

  it('keel_status reports the latest scan', async () => {
    const { text } = await call('keel_status');
    expect(text).toContain('ledger 64657803');
  });

  it('only ever issues GET requests', async () => {
    await call('get_asset_risk', { assetId: USTRY });
    await call('list_assets');
    await call('keel_status');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
