import {
  chefLegalIdentity,
  legalIdentityLines,
  type ChefLegalRow,
} from './chef-legal.views';

const EMPTY: ChefLegalRow = {
  legalName: null,
  legalStatus: null,
  siren: null,
  businessAddress: null,
  vatRegime: null,
  vatNumber: null,
  insurerName: null,
  insuranceCoverage: null,
  mediatorName: null,
  mediatorUrl: null,
  sapDeclarationNumber: null,
  sapProfile: null,
};

const FULL: ChefLegalRow = {
  legalName: 'Marie Dupont EI',
  legalStatus: 'micro_entreprise',
  siren: '443061841',
  businessAddress: '5 rue du Marché, 93100 Montreuil',
  vatRegime: 'franchise',
  vatNumber: null,
  insurerName: 'MAAF Pro',
  insuranceCoverage: 'RC Pro, 2 000 000 € par sinistre',
  mediatorName: 'CM2C',
  mediatorUrl: 'https://www.cm2c.net',
  sapDeclarationNumber: 'SAP443061841',
  sapProfile: null,
};

describe('chefLegalIdentity', () => {
  it('words a complete identity as CGV art. 3.2 lists it', () => {
    expect(chefLegalIdentity(FULL)).toEqual({
      name: 'Marie Dupont EI',
      legalStatus: 'Entrepreneur individuel (micro-entreprise)',
      siren: '443061841',
      businessAddress: '5 rue du Marché, 93100 Montreuil',
      vat: 'TVA non applicable, article 293 B du CGI',
      sapNumber: 'SAP443061841',
      insurance: { insurer: 'MAAF Pro', coverage: 'RC Pro, 2 000 000 € par sinistre' },
      mediator: { name: 'CM2C', url: 'https://www.cm2c.net' },
      contact: 'Par la messagerie de Lab’s Food',
      missing: [],
    });
  });

  it('lists what is missing, never inventing it', () => {
    const identity = chefLegalIdentity(EMPTY);
    expect(identity).toMatchObject({
      name: null,
      legalStatus: null,
      vat: null,
      sapNumber: null,
      insurance: null,
      mediator: null,
    });
    expect(identity.missing).toEqual([
      'name',
      'legalStatus',
      'siren',
      'businessAddress',
      'vat',
      'insurance',
      'mediator',
    ]);
  });

  it('needs the VAT number of a batch cooker who charges VAT', () => {
    const subject = { ...FULL, vatRegime: 'subject' };
    expect(chefLegalIdentity(subject)).toMatchObject({ vat: null, missing: ['vat'] });
    expect(chefLegalIdentity({ ...subject, vatNumber: 'FR12443061841' })).toMatchObject({
      vat: 'TVA intracommunautaire FR12443061841',
      missing: [],
    });
  });

  it('takes the NOVA code as SAP number when no declaration number is on file', () => {
    expect(
      chefLegalIdentity({
        ...FULL,
        sapDeclarationNumber: null,
        sapProfile: { novaCode: 'SAP123456789' },
      }).sapNumber,
    ).toBe('SAP123456789');
  });

  it('counts a half-filled insurance or mediator as missing', () => {
    expect(
      chefLegalIdentity({ ...FULL, insuranceCoverage: null, mediatorUrl: null }).missing,
    ).toEqual(['insurance', 'mediator']);
  });
});

describe('legalIdentityLines', () => {
  it('writes what is filled, one line each, the display name standing in for a missing name', () => {
    expect(legalIdentityLines(chefLegalIdentity(FULL), 'Chef Marie')).toEqual([
      'Marie Dupont EI',
      'Entrepreneur individuel (micro-entreprise)',
      'SIREN 443061841',
      '5 rue du Marché, 93100 Montreuil',
      'TVA non applicable, article 293 B du CGI',
      'Déclaration de services à la personne n° SAP443061841',
      'Assurance professionnelle : MAAF Pro, RC Pro, 2 000 000 € par sinistre',
      'Médiateur de la consommation : CM2C (https://www.cm2c.net)',
      'Contact : par la messagerie de Lab’s Food',
    ]);
    expect(legalIdentityLines(chefLegalIdentity(EMPTY), 'Chef Marie')).toEqual([
      'Chef Marie',
      'Contact : par la messagerie de Lab’s Food',
    ]);
  });
});
