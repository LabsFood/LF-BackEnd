import { chefOnboarding } from './chef-onboarding-steps.rules';

const NOTHING = {
  isVerified: true,
  isActive: false,
  avatarUrl: null,
  bio: null,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  activeOffers: 0,
  openings: 0,
  publishedMenus: 0,
};

describe('chefOnboarding (2026-11-24)', () => {
  it('lists the steps in order, none done for a freshly approved chef', () => {
    const checklist = chefOnboarding(NOTHING);

    expect(checklist.steps.map((s) => s.code)).toEqual([
      'showcase',
      'payouts',
      'service_offer',
      'availability',
      'first_menu',
    ]);
    expect(checklist).toMatchObject({
      completed: 0,
      total: 5,
      allDone: false,
      verified: true,
      online: false,
    });
  });

  it('needs both a photo and a bio for the showcase', () => {
    const photoOnly = chefOnboarding({
      ...NOTHING,
      avatarUrl: 'https://r2/a.jpg',
      bio: '  ',
    });
    expect(photoOnly.steps[0].done).toBe(false);

    const both = chefOnboarding({
      ...NOTHING,
      avatarUrl: 'https://r2/a.jpg',
      bio: 'Cuisine du Sud',
    });
    expect(both.steps[0].done).toBe(true);
  });

  it('needs Stripe charges and payouts enabled', () => {
    expect(chefOnboarding({ ...NOTHING, stripeChargesEnabled: true }).steps[1].done).toBe(
      false,
    );
    expect(
      chefOnboarding({
        ...NOTHING,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      }).steps[1].done,
    ).toBe(true);
  });

  it('is all done once every step exists, and online only when verified and active', () => {
    const checklist = chefOnboarding({
      ...NOTHING,
      isActive: true,
      avatarUrl: 'https://r2/a.jpg',
      bio: 'Cuisine du Sud',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      activeOffers: 1,
      openings: 3,
      publishedMenus: 2,
    });

    expect(checklist).toMatchObject({ completed: 5, allDone: true, online: true });
    expect(chefOnboarding({ ...NOTHING, isVerified: false, isActive: true }).online).toBe(
      false,
    );
  });
});
