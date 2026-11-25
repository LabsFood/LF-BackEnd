/**
 * LF-0221 (2026-11-10): what a client is invited to do after creating the
 * account, as a "getting started" checklist. Derived from what is stored, never
 * kept: a step is done as soon as the data exists, however it got there.
 *
 * Nothing here blocks. The allergy declaration keeps its own fail-closed rule (no
 * menu validated before it, allergies.rules.ts): the step only says so, with
 * `requiredFor`, so the front can explain why a menu waits.
 */

export interface ClientOnboardingFacts {
  fullName: string | null;
  phone: string | null;
  profile: {
    addressStreet: string | null;
    addressCity: string | null;
    addressPostalCode: string | null;
    allergiesDeclaredAt: Date | null;
    dietaryPreferences: string[];
    dislikes: string[];
    favorites: string[];
    spiceLevel: number | null;
  } | null;
  bookings: number;
  /** The immediate advance is open (`URSSAF_GATEWAY` not `disabled`). */
  advanceOffered?: boolean;
  /** The URSSAF dossier the advance needs is filled (`/me/urssaf-dossier`). */
  urssafDossierFilled?: boolean;
}

export type ClientOnboardingStep =
  | 'contact_details'
  | 'address'
  | 'allergies'
  | 'tastes'
  | 'urssaf_dossier'
  | 'first_booking';

const filled = (value: string | null | undefined) => !!value?.trim();

export function clientOnboarding(facts: ClientOnboardingFacts) {
  const p = facts.profile;
  const steps: {
    code: ClientOnboardingStep;
    done: boolean;
    requiredFor?: 'menu_validation' | 'immediate_advance';
  }[] = [
    { code: 'contact_details', done: filled(facts.fullName) && filled(facts.phone) },
    {
      code: 'address',
      done:
        !!p &&
        filled(p.addressStreet) &&
        filled(p.addressCity) &&
        filled(p.addressPostalCode),
    },
    { code: 'allergies', done: !!p?.allergiesDeclaredAt, requiredFor: 'menu_validation' },
    {
      code: 'tastes',
      done:
        !!p &&
        (p.dietaryPreferences.length > 0 ||
          p.dislikes.length > 0 ||
          p.favorites.length > 0 ||
          p.spiceLevel !== null),
    },
    // Only while the advance is offered: otherwise it would ask for an IBAN for nothing.
    ...(facts.advanceOffered
      ? [
          {
            code: 'urssaf_dossier' as const,
            done: !!facts.urssafDossierFilled,
            requiredFor: 'immediate_advance' as const,
          },
        ]
      : []),
    { code: 'first_booking', done: facts.bookings > 0 },
  ];
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, allDone: completed === steps.length };
}
