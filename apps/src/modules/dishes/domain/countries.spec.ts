import { isISO31661Alpha2 } from 'class-validator';
// class-validator does not wrap the numeric check; validator, its dependency, has it.
import isISO31661Numeric from 'validator/lib/isISO31661Numeric';

import { COUNTRY_CODES, country } from './countries';

describe('country table', () => {
  it('covers exactly the ISO 3166-1 alpha-2 codes, each with a valid numeric code', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    for (const code of COUNTRY_CODES) {
      expect(isISO31661Alpha2(code)).toBe(true);
      expect(isISO31661Numeric(country(code)!.iso3166Numeric)).toBe(true);
    }
  });

  it('never gives two countries the same numeric code', () => {
    const numerics = COUNTRY_CODES.map((code) => country(code)!.iso3166Numeric);
    expect(new Set(numerics).size).toBe(numerics.length);
  });

  it('maps the countries the product cooks most', () => {
    expect(country('FR')).toEqual({ code: 'FR', iso3166Numeric: '250', name: 'France' });
    expect(country('sn')?.iso3166Numeric).toBe('686');
    expect(country('VN')?.iso3166Numeric).toBe('704');
    expect(country('MA')?.iso3166Numeric).toBe('504');
  });

  it('answers null for an unknown or legacy free-text country', () => {
    expect(country('Sénégal')).toBeNull();
    expect(country(null)).toBeNull();
  });
});
