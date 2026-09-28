import { getOracleDecimals, getOraclePrice, PoolMetadata, PoolV2, type Network } from '@blend-capital/blend-sdk';
import { Asset, Networks } from '@stellar/stellar-sdk';

import type { AssetSummary } from '../api/client.js';
import { D } from '../domain/decimal.js';
import { DEFAULT_SOROBAN_RPC_URL, poolStatusLabel } from './pools.js';

/**
 * Reads a Blend V2 pool from Soroban RPC and returns it as plain data. Every
 * amount is converted from the on-chain fixed point integer to an exact decimal
 * string here, once, so nothing downstream touches a bigint or a float. This is
 * the only file in the audit that does I/O against Stellar.
 */

export interface BlendReserveSnapshot {
  /** The Stellar Asset Contract (or token contract) id of the reserve. */
  assetContractId: string;
  decimals: number;
  /** Collateral factor as a fraction, e.g. "0.75". Zero means not usable as collateral. */
  collateralFactor: string;
  enabled: boolean;
  /** Maximum total supply the pool accepts, in asset units. */
  supplyCap: string;
  /** Current total supplied, in asset units. */
  totalSupplied: string;
  /** Current total borrowed, in asset units. */
  totalBorrowed: string;
  /** The pool oracle's last price, in the oracle's base (USD for Reflector). Null when it could not be read. */
  oraclePrice: string | null;
  oraclePriceTimestamp: number | null;
}

export interface BlendPoolSnapshot {
  poolId: string;
  name: string;
  status: number;
  statusLabel: string;
  oracle: string;
  latestLedger: number;
  loadedAt: string;
  rpcUrl: string;
  reserves: BlendReserveSnapshot[];
}

export interface BlendLoadOptions {
  rpcUrl?: string;
  /** Oracle reads are one simulation per asset; skip them when only sizes matter. */
  withOraclePrices?: boolean;
}

function network(rpcUrl: string): Network {
  return { rpc: rpcUrl, passphrase: Networks.PUBLIC, opts: {} };
}

function scaled(value: bigint | number, decimals: number): string {
  return new D(value.toString()).div(new D(10).pow(decimals)).toString();
}

export async function loadBlendPool(poolId: string, options: BlendLoadOptions = {}): Promise<BlendPoolSnapshot> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_SOROBAN_RPC_URL;
  const net = network(rpcUrl);
  const metadata = await PoolMetadata.load(net, poolId);
  const pool = await PoolV2.loadWithMetadata(net, poolId, metadata);

  const prices = new Map<string, { price: string; timestamp: number }>();
  if (options.withOraclePrices !== false) {
    try {
      const { decimals } = await getOracleDecimals(net, metadata.oracle);
      await Promise.all(
        [...pool.reserves.keys()].map(async (assetId) => {
          try {
            const data = await getOraclePrice(net, metadata.oracle, assetId);
            prices.set(assetId, { price: scaled(data.price, decimals), timestamp: data.timestamp });
          } catch {
            // A missing price is reported as null, never as zero.
          }
        }),
      );
    } catch {
      // Oracle unreachable: every price stays null.
    }
  }

  const reserves = [...pool.reserves.values()]
    .map((reserve): BlendReserveSnapshot => {
      const decimals = reserve.config.decimals;
      const config = reserve.config as typeof reserve.config & { supply_cap?: bigint; enabled?: boolean };
      const price = prices.get(reserve.assetId);
      return {
        assetContractId: reserve.assetId,
        decimals,
        collateralFactor: scaled(reserve.config.c_factor, 7),
        enabled: config.enabled ?? true,
        supplyCap: scaled(config.supply_cap ?? 0n, decimals),
        totalSupplied: scaled(reserve.totalSupply(), decimals),
        totalBorrowed: scaled(reserve.totalLiabilities(), decimals),
        oraclePrice: price?.price ?? null,
        oraclePriceTimestamp: price?.timestamp ?? null,
      };
    })
    // Map iteration order is insertion order from RPC; sort for reproducible output.
    .sort((a, b) => a.assetContractId.localeCompare(b.assetContractId));

  return {
    poolId,
    name: metadata.name,
    status: metadata.status,
    statusLabel: poolStatusLabel(metadata.status),
    oracle: metadata.oracle,
    latestLedger: metadata.latestLedger,
    loadedAt: new Date().toISOString(),
    rpcUrl,
    reserves,
  };
}

type AssetRef = AssetSummary['asset'];

function contractEntry(ref: AssetRef): [string, string] {
  const native = ref.type === 'native' || !ref.issuer;
  const asset = native ? Asset.native() : new Asset(ref.code, ref.issuer!);
  return [asset.contractId(Networks.PUBLIC), native ? 'XLM' : `${ref.code}:${ref.issuer}`];
}

/** The Stellar Asset Contract id of every asset Keel monitors, keyed back to its Keel id. */
export function keelIdsByContract(assets: AssetSummary[]): Map<string, string> {
  return new Map(assets.map((item) => contractEntry(item.asset)));
}

/** The contract ids of the quote assets Keel measures in (USDC), which it does not monitor as assets. */
export function quoteIdsByContract(assets: AssetSummary[]): Map<string, string> {
  return new Map(assets.map((item) => contractEntry(item.quote)));
}
