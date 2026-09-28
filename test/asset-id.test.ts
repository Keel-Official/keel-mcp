import { describe, expect, it } from 'vitest';

import { formatAssetId, normalizeAssetId } from '../src/domain/asset-id.js';
import { USTRY } from './helpers.js';

describe('normalizeAssetId', () => {
  it('accepts CODE:ISSUER and the encoded colon', () => {
    expect(normalizeAssetId(USTRY)).toBe(USTRY);
    expect(normalizeAssetId(` ${USTRY.replace(':', '%3A')} `)).toBe(USTRY);
  });

  it.each(['XLM', 'xlm', 'native'])('maps %j to XLM', (value) => {
    expect(normalizeAssetId(value)).toBe('XLM');
  });

  it.each(['USTRY', 'USDC:notanissuer', 'TOOLONGCODE123:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC'])(
    'rejects %j and points at find_asset',
    (value) => {
      expect(() => normalizeAssetId(value)).toThrow(/find_asset/);
    },
  );
});

describe('formatAssetId', () => {
  it('renders native and issued assets', () => {
    expect(formatAssetId({ code: 'XLM', type: 'native', issuer: null })).toBe('XLM');
    expect(formatAssetId({ code: 'USTRY', type: 'credit_alphanum12', issuer: USTRY.split(':')[1] })).toBe(USTRY);
  });
});
