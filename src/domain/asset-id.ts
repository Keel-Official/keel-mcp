/**
 * An asset in Keel is the pair (code, issuer), never the ticker alone. Two issuers
 * can publish the same code (the demonstration set holds several USDY issuers), so
 * every tool takes the full `CODE:ISSUER` id and nothing here guesses an issuer.
 */

/** The contract's `AssetId` pattern, with the colon already decoded. */
const ASSET_ID = /^(XLM|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/;

export class InvalidAssetIdError extends Error {
  constructor(value: string) {
    super(
      `"${value}" is not a Keel asset id. Use CODE:ISSUER for an issued asset ` +
        '(for example USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN) ' +
        'or XLM for the native asset. Call find_asset to look an issuer up by code.',
    );
    this.name = 'InvalidAssetIdError';
  }
}

/**
 * Accepts the forms a person or a model is likely to type and returns the one the
 * API expects: surrounding whitespace, a `%3A` colon, and `native` for XLM.
 */
export function normalizeAssetId(value: string): string {
  const trimmed = value.trim().replace(/%3A/gi, ':');
  const candidate = /^(xlm|native)$/i.test(trimmed) ? 'XLM' : trimmed;
  if (!ASSET_ID.test(candidate)) throw new InvalidAssetIdError(value);
  return candidate;
}

export interface AssetLike {
  code: string;
  type?: string;
  issuer?: string | null;
}

export function formatAssetId(asset: AssetLike): string {
  if (asset.type === 'native' || !asset.issuer) return asset.code;
  return `${asset.code}:${asset.issuer}`;
}
