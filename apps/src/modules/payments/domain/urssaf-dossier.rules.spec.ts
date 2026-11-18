import {
  dossierProblems,
  ibanLast4,
  normalizeDossier,
  type UrssafDossier,
} from './urssaf-dossier.rules';

const VALID: UrssafDossier = {
  civility: 'F',
  birthName: 'Marchand',
  usageName: null,
  firstNames: 'Sophie Anne',
  birthDate: '1981-04-12',
  birthCountryCode: '99100',
  birthDepartmentCode: '075',
  birthCommuneCode: '75056',
  birthCommuneName: 'Paris',
  mobilePhone: '06 12 34 56 78',
  email: 'sophie@exemple.fr',
  address: {
    line1: '12 rue des Lilas',
    line2: null,
    postalCode: '75011',
    city: 'Paris',
    countryCode: '99100',
  },
  iban: 'fr76 3000 6000 0112 3456 7890 189',
  bic: 'AGRIFRPP',
  accountHolder: 'Sophie Marchand',
};

const codes = (d: UrssafDossier) =>
  dossierProblems(normalizeDossier(d)).map((p) => `${p.field}:${p.code}`);

describe('urssaf-dossier rules', () => {
  it('accepts a complete French dossier', () => {
    expect(codes(VALID)).toEqual([]);
  });

  it('normalises the IBAN and the phone', () => {
    const d = normalizeDossier(VALID);
    expect(d.iban).toBe('FR7630006000011234567890189');
    expect(d.mobilePhone).toBe('0612345678');
    expect(ibanLast4(d.iban)).toBe('0189');
  });

  it('refuses an IBAN whose checksum fails', () => {
    expect(codes({ ...VALID, iban: 'FR7630006000011234567890188' })).toEqual([
      'iban:INVALID_IBAN',
    ]);
  });

  it('accepts only French mobiles (06, 07, +33)', () => {
    expect(codes({ ...VALID, mobilePhone: '+33712345678' })).toEqual([]);
    expect(codes({ ...VALID, mobilePhone: '0112345678' })).toEqual([
      'mobilePhone:INVALID_MOBILE',
    ]);
  });

  it('refuses digits and stray separators in names', () => {
    expect(codes({ ...VALID, birthName: "D'Artagnan-Lévêque" })).toEqual([]);
    expect(codes({ ...VALID, birthName: 'Marchand2' })).toEqual([
      'birthName:INVALID_NAME',
    ]);
    expect(codes({ ...VALID, firstNames: '-Sophie' })).toEqual([
      'firstNames:INVALID_NAME',
    ]);
  });

  it('needs the department and commune for a birth in France, matching each other', () => {
    expect(codes({ ...VALID, birthCommuneCode: null })).toEqual([
      'birthCommuneCode:REQUIRED',
    ]);
    expect(codes({ ...VALID, birthCommuneCode: '13055' })).toEqual([
      'birthCommuneCode:COMMUNE_NOT_IN_DEPARTMENT',
    ]);
    expect(
      codes({
        ...VALID,
        birthDepartmentCode: '971',
        birthCommuneCode: '97101',
        birthCommuneName: 'Les Abymes',
      }),
    ).toEqual([]);
    expect(
      codes({
        ...VALID,
        birthDepartmentCode: '02A',
        birthCommuneCode: '2A004',
        birthCommuneName: 'Ajaccio',
      }),
    ).toEqual([]);
  });

  it('leaves department and commune out for a birth abroad', () => {
    const abroad = {
      ...VALID,
      birthCountryCode: '99134',
      birthDepartmentCode: null,
      birthCommuneCode: null,
      birthCommuneName: null,
    };
    expect(codes(abroad)).toEqual([]);
    expect(codes({ ...abroad, birthCommuneCode: '75056' })).toEqual([
      'birthCommuneCode:NOT_FOR_BIRTH_ABROAD',
    ]);
  });

  it('refuses a birth date in the future or malformed', () => {
    expect(codes({ ...VALID, birthDate: '2999-01-01' })).toEqual([
      'birthDate:INVALID_DATE',
    ]);
    expect(codes({ ...VALID, birthDate: '1981-02-30' })).toEqual([
      'birthDate:INVALID_DATE',
    ]);
  });

  it('needs a five-digit postcode for a French address', () => {
    expect(
      codes({ ...VALID, address: { ...VALID.address, postalCode: '7501' } }),
    ).toEqual(['address.postalCode:INVALID_POSTAL_CODE']);
  });

  it('refuses a malformed BIC', () => {
    expect(codes({ ...VALID, bic: 'AGRI' })).toEqual(['bic:INVALID_BIC']);
  });
});
