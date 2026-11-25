import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UrssafDossierDto } from './urssaf-dossier.dto';

const DOSSIER = {
  civility: 'F',
  birthName: 'Martin',
  firstNames: 'Sophie',
  birthDate: '1985-04-12',
  birthCountryCode: '99100',
  mobilePhone: '0612345678',
  email: 'sophie@exemple.fr',
  address: {
    line1: '12 rue des Lilas',
    postalCode: '75011',
    city: 'Paris',
    countryCode: '99100',
  },
  iban: 'FR7630006000011234567890189',
  bic: 'AGRIFRPP',
  accountHolder: 'Sophie Martin',
};

function validate(payload: Record<string, unknown>): string[] {
  const errors = validateSync(plainToInstance(UrssafDossierDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('UrssafDossierDto', () => {
  it('accepts a complete dossier', () => {
    expect(validate(DOSSIER)).toEqual([]);
  });

  // A missing address used to pass the shape check and break the rules behind it (500).
  it.each([undefined, null, 'Paris', []])('refuses the address %p', (address) => {
    expect(validate({ ...DOSSIER, address })).toContain('address');
  });

  it('refuses an address without its lines', () => {
    expect(validate({ ...DOSSIER, address: {} })).toContain('address');
  });
});
