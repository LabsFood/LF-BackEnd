import { advanceAccepted } from './chef-cesu-info';

const ACTIVE = { status: 'active' };

describe('advanceAccepted', () => {
  it('needs the URSSAF habilitation, the NOVA code and an active mandate', () => {
    expect(
      advanceAccepted(
        { urssafTiersPrestationStatus: 'active', novaCode: 'SAP123456789' },
        ACTIVE,
      ),
    ).toBe(true);
  });

  it('is off without the NOVA code: the intermediary cannot enter the request', () => {
    expect(
      advanceAccepted({ urssafTiersPrestationStatus: 'active', novaCode: null }, ACTIVE),
    ).toBe(false);
    expect(
      advanceAccepted({ urssafTiersPrestationStatus: 'active', novaCode: '  ' }, ACTIVE),
    ).toBe(false);
  });

  it('is off without the habilitation or the mandate', () => {
    const sap = { urssafTiersPrestationStatus: 'pending', novaCode: 'SAP123456789' };
    expect(advanceAccepted(sap, ACTIVE)).toBe(false);
    expect(
      advanceAccepted(
        { ...sap, urssafTiersPrestationStatus: 'active' },
        { status: 'pending' },
      ),
    ).toBe(false);
  });
});
