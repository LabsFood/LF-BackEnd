import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateMeSapProfileDto } from './sap-profile.dto';

function validate(payload: Record<string, unknown>): string[] {
  const errors = validateSync(plainToInstance(UpdateMeSapProfileDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('UpdateMeSapProfileDto', () => {
  it('accepts a type A declaration with a NOVA code', () => {
    expect(
      validate({ declarationType: 'type_a_nova', novaCode: 'SAP123456789' }),
    ).toEqual([]);
  });

  it('rejects a type A declaration without a NOVA code', () => {
    expect(validate({ declarationType: 'type_a_nova' })).toContain('novaCode');
  });

  it('accepts a type B declaration with cooperative name and proof', () => {
    expect(
      validate({
        declarationType: 'type_b_cooperative',
        cooperativeName: 'Unipros',
        cooperativeMembershipProof: 'https://files.test/proof.pdf',
      }),
    ).toEqual([]);
  });

  it('rejects a type B declaration missing the cooperative name', () => {
    expect(
      validate({
        declarationType: 'type_b_cooperative',
        cooperativeMembershipProof: 'https://files.test/proof.pdf',
      }),
    ).toContain('cooperativeName');
  });

  it('does not require the other type fields', () => {
    expect(
      validate({ declarationType: 'type_b_cooperative', cooperativeName: 'Unipros' }),
    ).not.toContain('novaCode');
  });

  it('rejects an unknown declaration type', () => {
    expect(validate({ declarationType: 'type_c' })).toContain('declarationType');
  });

  it('refuses a CRCESU number: CESU is paid to the platform, not the chef', () => {
    expect(
      validate({
        declarationType: 'type_a_nova',
        novaCode: 'SAP123456789',
        crcesuNan: '1234567',
      }),
    ).toContain('crcesuNan');
  });

  it('rejects the externally-owned status fields', () => {
    expect(
      validate({
        declarationType: 'type_a_nova',
        novaCode: 'SAP123456789',
        urssafTiersPrestationStatus: 'active',
        crcesuAffiliationStatus: 'active',
      }),
    ).toEqual(
      expect.arrayContaining(['urssafTiersPrestationStatus', 'crcesuAffiliationStatus']),
    );
  });
});
