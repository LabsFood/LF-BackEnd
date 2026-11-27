import { advanceAccepted } from './chef-cesu-info';

const ACTIVE = { status: 'active' };
const HABILITATED = { urssafTiersPrestationStatus: 'active' };

describe('advanceAccepted', () => {
  const saved = process.env.SAP_DECLARATION_NUMBER;
  beforeEach(() => {
    process.env.SAP_DECLARATION_NUMBER = 'SAP100715036';
  });
  afterAll(() => {
    process.env.SAP_DECLARATION_NUMBER = saved;
  });

  it('needs the URSSAF habilitation, the SAS SAP number and an active mandate', () => {
    expect(advanceAccepted(HABILITATED, ACTIVE)).toBe(true);
  });

  it('no longer depends on the chef own NOVA: the request goes under the SAS SAP', () => {
    expect(advanceAccepted({ ...HABILITATED, novaCode: null } as never, ACTIVE)).toBe(
      true,
    );
  });

  it('is off while the SAS SAP number is not configured', () => {
    delete process.env.SAP_DECLARATION_NUMBER;
    expect(advanceAccepted(HABILITATED, ACTIVE)).toBe(false);
    process.env.SAP_DECLARATION_NUMBER = '  ';
    expect(advanceAccepted(HABILITATED, ACTIVE)).toBe(false);
  });

  it('is off without the habilitation or the mandate', () => {
    expect(advanceAccepted({ urssafTiersPrestationStatus: 'pending' }, ACTIVE)).toBe(
      false,
    );
    expect(advanceAccepted(HABILITATED, { status: 'pending' })).toBe(false);
  });
});
