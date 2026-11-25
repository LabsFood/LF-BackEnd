/**
 * 2026-11-24: what a batch cooker is invited to do once the dossier is approved, so
 * clients can find and book them: the "getting started" checklist of the chef
 * space, the counterpart of the client one (client-onboarding.rules.ts).
 *
 * Derived from what is stored, never kept: a step is done as soon as the data
 * exists, however it got there. Nothing here blocks or publishes; going online
 * stays an admin decision (`isActive`), reported as `online`.
 */

export interface ChefOnboardingFacts {
  isVerified: boolean;
  isActive: boolean;
  /** Profile photo (`users.avatar_url`). */
  avatarUrl: string | null;
  bio: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  /** Active service offers ("formules"). */
  activeOffers: number;
  /** Weekly working hours plus upcoming `extra` openings. */
  openings: number;
  /** Menus the chef owns that are published. */
  publishedMenus: number;
}

export type ChefOnboardingStep =
  'showcase' | 'payouts' | 'service_offer' | 'availability' | 'first_menu';

const filled = (value: string | null | undefined) => !!value?.trim();

export function chefOnboarding(facts: ChefOnboardingFacts) {
  const steps: { code: ChefOnboardingStep; done: boolean }[] = [
    { code: 'showcase', done: filled(facts.avatarUrl) && filled(facts.bio) },
    {
      code: 'payouts',
      done: facts.stripeChargesEnabled && facts.stripePayoutsEnabled,
    },
    { code: 'service_offer', done: facts.activeOffers > 0 },
    { code: 'availability', done: facts.openings > 0 },
    { code: 'first_menu', done: facts.publishedMenus > 0 },
  ];
  const completed = steps.filter((s) => s.done).length;
  return {
    steps,
    completed,
    total: steps.length,
    allDone: completed === steps.length,
    verified: facts.isVerified,
    online: facts.isVerified && facts.isActive,
  };
}
