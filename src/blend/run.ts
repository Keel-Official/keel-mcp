import { KeelApiError, type KeelApi } from '../api/client.js';
import { auditPool, type KeelLookup, type PoolAudit } from './audit.js';
import { keelIdsByContract, loadBlendPool, quoteIdsByContract, type BlendLoadOptions } from './load.js';

/**
 * Audits one or more Blend pools: reads each pool from Soroban RPC, reads Keel
 * once per distinct monitored asset, and runs the pure audit.
 */
export async function runBlendAudit(
  api: KeelApi,
  poolIds: string[],
  options: BlendLoadOptions = {},
): Promise<PoolAudit[]> {
  const [{ data: assets }, snapshots] = await Promise.all([
    api.allAssets(),
    Promise.all(poolIds.map((id) => loadBlendPool(id, options))),
  ]);
  const keelIds = keelIdsByContract(assets.items);
  const quoteIds = quoteIdsByContract(assets.items);

  const wanted = new Set<string>();
  for (const snapshot of snapshots) {
    for (const reserve of snapshot.reserves) {
      const id = keelIds.get(reserve.assetContractId);
      if (id) wanted.add(id);
    }
  }

  const lookup: KeelLookup = new Map();
  await Promise.all(
    [...wanted].sort().map(async (id) => {
      try {
        lookup.set(id, (await api.depth(id)).data);
      } catch (error) {
        lookup.set(id, {
          error: error instanceof KeelApiError ? `${error.code}: ${error.message}` : String(error),
        });
      }
    }),
  );

  return snapshots.map((snapshot) => auditPool(snapshot, keelIds, lookup, quoteIds));
}
