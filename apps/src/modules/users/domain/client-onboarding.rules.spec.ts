import { clientOnboarding } from './client-onboarding.rules';

const NOTHING = {
  fullName: null,
  phone: null,
  profile: null,
  bookings: 0,
};

const DONE = {
  fullName: 'Alice Martin',
  phone: '+33612345678',
  profile: {
    addressStreet: '12 rue des Lilas',
    addressCity: 'Lyon',
    addressPostalCode: '69003',
    allergiesDeclaredAt: new Date('2026-11-10T09:00:00Z'),
    dietaryPreferences: [],
    dislikes: ['coriandre'],
    favorites: [],
    spiceLevel: null,
  },
  bookings: 1,
};

describe('clientOnboarding (LF-0221)', () => {
  it('lists the steps in order, none done for a new account', () => {
    const checklist = clientOnboarding(NOTHING);

    expect(checklist.steps.map((s) => s.code)).toEqual([
      'contact_details',
      'address',
      'allergies',
      'tastes',
      'first_booking',
    ]);
    expect(checklist).toMatchObject({ completed: 0, total: 5, allDone: false });
  });

  it('counts what the client already did', () => {
    expect(clientOnboarding(DONE)).toMatchObject({
      completed: 5,
      total: 5,
      allDone: true,
    });
  });

  // Fail-closed stays where it was (no menu validated without a declaration); the
  // checklist itself never blocks, it only says which step something waits on.
  it('marks the allergy declaration as needed before a menu is validated', () => {
    const allergies = clientOnboarding(NOTHING).steps.find((s) => s.code === 'allergies');

    expect(allergies).toEqual({
      code: 'allergies',
      done: false,
      requiredFor: 'menu_validation',
    });
  });

  it('counts "no allergy" as declared, and an address only when complete', () => {
    const checklist = clientOnboarding({
      ...NOTHING,
      profile: {
        ...DONE.profile,
        addressPostalCode: null,
        dislikes: [],
        allergiesDeclaredAt: new Date('2026-11-10T09:00:00Z'),
      },
    });

    const done = Object.fromEntries(checklist.steps.map((s) => [s.code, s.done]));
    expect(done).toMatchObject({ address: false, allergies: true, tastes: false });
  });
});
