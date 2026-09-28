import { describe, expect, it } from 'vitest';

import { bracketTrade, checkCollateral } from '../src/domain/compare.js';
import { D, parseAmount } from '../src/domain/decimal.js';
import { loadRisk } from './helpers.js';

describe('checkCollateral', () => {
  const ustry = loadRisk('ustry');

  it('flags an amount above the published limit and names the binding term', () => {
    const check = checkCollateral(ustry, parseAmount('500000'));
    expect(check.verdict).toBe('exceeds');
    expect(check.maxSafeCollateral).toBe('69120.494708158027884399913875');
    expect(check.ratio?.startsWith('7.23')).toBe(true);
    expect(new D(check.headroom!).isNegative()).toBe(true);
    // 69120.49 (manipulation) < 133252.90 (liquidation)
    expect(check.bindingTerm).toBe('manipulation');
  });

  it('treats an amount exactly at the limit as within, with zero headroom', () => {
    const check = checkCollateral(ustry, parseAmount('69120.494708158027884399913875'));
    expect(check.verdict).toBe('within');
    expect(new D(check.headroom!).isZero()).toBe(true);
    expect(check.ratio).toBe('1');
  });

  it('says the band still matters when the size is within the limit', () => {
    const check = checkCollateral(ustry, parseAmount('1000'));
    expect(check.verdict).toBe('within');
    expect(check.caveats.some((c) => c.includes('band HIGH'))).toBe(true);
    expect(check.caveats.some((c) => c.includes('partial'))).toBe(true);
  });

  it('answers unknown, not safe, when no limit is published', () => {
    const noPrice = { ...ustry, priceSource: 'none' as const, maxSafeCollateral: null, maxSafeCollateralLiquidation: null, maxSafeCollateralManipulation: null };
    const check = checkCollateral(noPrice, parseAmount('10'));
    expect(check.verdict).toBe('unknown');
    expect(check.ratio).toBeNull();
    expect(check.bindingTerm).toBeNull();
    expect(check.caveats[0]).toMatch(/no executable price/);
  });

  it('falls back to the liquidation term when the manipulation term is not applied', () => {
    const risk = { ...ustry, maxSafeCollateralManipulation: null, maxSafeCollateral: ustry.maxSafeCollateralLiquidation };
    expect(checkCollateral(risk, parseAmount('1')).bindingTerm).toBe('liquidation');
  });
});

describe('bracketTrade', () => {
  const ustry = loadRisk('ustry');

  it('places a size inside the smallest rung that absorbs it', () => {
    const bracket = bracketTrade(ustry, 'sell', parseAmount('1000'));
    expect(bracket.withinDelta).toBe(0.02);
    expect(bracket.exceedsMeasuredDepth).toBe(false);
  });

  it('brackets between rungs without interpolating', () => {
    // sell side: 2% 266417.57, 5% 266505.37
    const bracket = bracketTrade(ustry, 'sell', parseAmount('266500'));
    expect(bracket.withinDelta).toBe(0.05);
    expect(bracket.summary).toContain('at most 5%');
    expect(bracket.summary).toContain('more than 2%');
  });

  it('reports a size beyond the deepest rung as exceeding the measured depth', () => {
    const bracket = bracketTrade(ustry, 'buy', parseAmount('300000'));
    expect(bracket.withinDelta).toBeNull();
    expect(bracket.exceedsMeasuredDepth).toBe(true);
    expect(bracket.rungs.every((r) => !r.fits)).toBe(true);
  });

  it('refuses to bracket when there is no executable price', () => {
    const bracket = bracketTrade({ ...ustry, priceSource: 'none' }, 'buy', parseAmount('1'));
    expect(bracket.withinDelta).toBeNull();
    expect(bracket.exceedsMeasuredDepth).toBe(false);
    expect(bracket.summary).toMatch(/no executable price/);
  });
});

describe('parseAmount', () => {
  it.each(['1e6', '1,000', '-5', '0', '$100', ''])('rejects %j', (value) => {
    expect(() => parseAmount(value)).toThrow();
  });

  it('keeps every digit', () => {
    expect(parseAmount('123456789.123456789123456789').toString()).toBe('123456789.123456789123456789');
  });
});
