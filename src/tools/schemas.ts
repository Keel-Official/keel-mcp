import { z } from 'zod';

/** Input fragments shared by several tools. Enums mirror the API contract. */

export const BANDS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const FLAGS = [
  'NO_EXECUTABLE_PRICE',
  'ZERO_DEPTH_2PCT',
  'MANIPULATION_CHEAP',
  'MANIPULATION_RATIO_LOW',
  'NO_GENUINE_TRADE_30D',
  'NO_GENUINE_TRADE_7D',
  'HOLDER_CONCENTRATION_EXTREME',
  'HOLDER_CONCENTRATION_HIGH',
  'THIN_DEPTH_5PCT',
  'WASH_TRADE_SUSPECTED',
  'SPREAD_EXTREME',
  'PRICE_SOURCE_CONFLICT',
] as const;

export const SOURCES = ['horizon', 'hubble', 'offers-implied', 'trades-implied'] as const;

export const assetId = z
  .string()
  .min(1)
  .describe(
    'Keel asset id: CODE:ISSUER for an issued asset (for example ' +
      'USTRY:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC), or XLM. ' +
      'An asset is the (code, issuer) pair, never the ticker alone: use find_asset first when only a code is known.',
  );

export const quote = z
  .string()
  .optional()
  .describe(
    'Optional quote asset id. Omit it: every monitored asset is measured against USDC, ' +
      'and every notional in the answer is in that quote asset.',
  );

export const amount = z
  .string()
  .describe(
    'A plain decimal amount in the quote asset (USDC unless quote is given), for example "500000" or "1250.5". ' +
      'A string, not a number, so no precision is lost.',
  );
