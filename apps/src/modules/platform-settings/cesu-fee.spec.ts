import {
  cesuFeeBpsFor,
  cesuFeeCents,
  DEFAULT_CESU_FEE_BPS,
  readCesuFeeRules,
} from './cesu-fee';

describe('CESU fee', () => {
  it('is cascaded after the commission: 150 € at 15 % then 10 % leaves 114,75 €', () => {
    const amount = 15_000;
    const commission = 2_250;
    const fee = cesuFeeCents(amount, commission, 1_000);
    expect(fee).toBe(1_275);
    expect(amount - commission - fee).toBe(11_475);
  });

  it('never goes negative when the commission covers everything', () => {
    expect(cesuFeeCents(1_000, 1_200, 1_000)).toBe(0);
  });

  it('defaults to 10 % for every tier while nothing was saved', () => {
    const rules = readCesuFeeRules(undefined);
    expect(rules).toEqual({ defaultBps: DEFAULT_CESU_FEE_BPS, byTier: {} });
    expect(cesuFeeBpsFor(rules, 'tier_3')).toBe(1_000);
  });

  it('applies a tier rate over the default, and the default elsewhere', () => {
    const rules = readCesuFeeRules({ defaultBps: 800, byTier: { tier_2: 500 } });
    expect(cesuFeeBpsFor(rules, 'tier_2')).toBe(500);
    expect(cesuFeeBpsFor(rules, 'tier_1')).toBe(800);
  });

  it('ignores a saved value that is out of bounds or not a whole number', () => {
    const rules = readCesuFeeRules({
      defaultBps: 9_999,
      byTier: { tier_1: 2.5, tier_2: -1 },
    });
    expect(rules).toEqual({ defaultBps: DEFAULT_CESU_FEE_BPS, byTier: {} });
  });
});
