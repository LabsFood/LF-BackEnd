import { HttpException, UnprocessableEntityException } from '@nestjs/common';

import {
  allergenConflict,
  allergensUnverified,
  allergiesNotDeclared,
  healthConsentRequired,
} from '../../dishes/domain/content.errors';
import { ALLERGENS } from '../../dishes/domain/dishes.rules';

/**
 * Client allergies (Recettes lot 1): health data, so fail-closed. No menu is
 * validated until the client answered once, a list with consent or "none"; a dish
 * that cannot be checked is refused; "verified" is said only when nothing is left
 * for a person to check.
 *
 * Only the 14 regulated allergens can be checked against a dish. Free text (the
 * client's "Autre", the quote request) counts when it names one of them exactly;
 * the rest goes to the batch cooker as text and keeps the check "unverified".
 */

/**
 * The text the client accepts before listing allergies. Changing the text means a
 * new version: a declaration then needs the new one.
 *
 * ponytail: draft until legal validates it (BLK-25), with no retention period yet.
 */
export const HEALTH_CONSENT = {
  version: 'brouillon-2026-11-02',
  text:
    'J’accepte que Lab’s Food enregistre mes allergies alimentaires et les transmette ' +
    'aux batch cookers qui cuisinent pour moi, dans le seul but d’écarter les plats qui ' +
    'les contiennent. Je peux retirer ce consentement à tout moment depuis mon profil : ' +
    'mes allergies sont alors effacées, et je ne peux plus valider de menu avant de les ' +
    'avoir déclarées à nouveau.',
} as const;

export interface ClientAllergies {
  allergies: string[];
  customAllergies: string[];
  allergiesNone: boolean;
  /** Null: the client never answered. */
  allergiesDeclaredAt: Date | null;
}

export interface DishAllergens {
  id: string;
  allergens: string[];
  allergensNone: boolean;
  /** Recettes lot 2: null until the chef verifies, and again after an ingredient change. */
  allergensVerifiedAt: Date | null;
}

export interface Conflict {
  mealId: string;
  allergens: string[];
}

export type AllergyReason =
  | 'ALLERGIES_NOT_DECLARED'
  | 'ALLERGENS_UNVERIFIED'
  | 'ALLERGEN_CONFLICT'
  | 'CUSTOM_ALLERGIES';

/** The columns these rules read, for a Prisma `select`. */
export const CLIENT_ALLERGY_SELECT = {
  allergies: true,
  customAllergies: true,
  allergiesNone: true,
  allergiesDeclaredAt: true,
} as const;

export const DISH_ALLERGEN_SELECT = {
  id: true,
  allergens: true,
  allergensNone: true,
  allergensVerifiedAt: true,
} as const;

/** Withdrawing consent erases the allergies and asks the question again. */
export const CONSENT_WITHDRAWN = {
  allergies: [],
  customAllergies: [],
  allergiesNone: false,
  allergiesDeclaredAt: null,
  healthConsentAt: null,
  healthConsentVersion: null,
};

/** No profile yet: nothing declared. */
const NOTHING: ClientAllergies = {
  allergies: [],
  customAllergies: [],
  allergiesNone: false,
  allergiesDeclaredAt: null,
};

// NFD leaves the œ ligature whole: « oeufs » must still find « Œufs ».
const fold = (word: string) =>
  word.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/œ/g, 'oe');

const CODE_BY_WORD = new Map(
  ALLERGENS.flatMap((a) => [
    [fold(a.code), a.code],
    [fold(a.label), a.code],
  ]),
);

const LABEL = new Map(ALLERGENS.map((a) => [a.code, a.label]));

const unique = <T>(items: T[]) => [...new Set(items)];

/** The allergens the platform can check, and the free text it cannot. */
export function checkable(client: ClientAllergies, extra: string[] = []) {
  const codes = new Set(client.allergies);
  const text: string[] = [];
  for (const word of [...client.customAllergies, ...extra]) {
    const code = CODE_BY_WORD.get(fold(word));
    if (code) codes.add(code);
    else text.push(word.trim());
  }
  return { codes: [...codes], text: unique(text) };
}

/**
 * Dishes the client cannot be checked against: their allergens are not verified
 * since the last ingredient change (Recettes §4.9), or they declare neither
 * allergens nor "none".
 */
export const unverifiedDishes = (dishes: DishAllergens[]) =>
  dishes
    .filter(
      (d) => !d.allergensVerifiedAt || (d.allergens.length === 0 && !d.allergensNone),
    )
    .map((d) => d.id);

export const conflicts = (codes: string[], dishes: DishAllergens[]): Conflict[] =>
  dishes
    .map((d) => ({
      mealId: d.id,
      allergens: d.allergens.filter((a) => codes.includes(a)),
    }))
    .filter((c) => c.allergens.length > 0);

/** Why this menu cannot be validated, in the contract's order; null when it can. */
export function menuRefusal(
  client: ClientAllergies | null,
  dishes: DishAllergens[],
  extra: string[] = [],
): HttpException | null {
  if (!client?.allergiesDeclaredAt) return allergiesNotDeclared();
  const unverified = unverifiedDishes(dishes);
  if (unverified.length) return allergensUnverified(unverified);
  const found = conflicts(checkable(client, extra).codes, dishes);
  return found.length ? allergenConflict(found) : null;
}

/** What the screens show, with every reason it is not "verified". */
export function allergyCheck(
  client: ClientAllergies | null,
  dishes: DishAllergens[] = [],
  extra: string[] = [],
) {
  const reasons: AllergyReason[] = [];
  if (!client?.allergiesDeclaredAt) reasons.push('ALLERGIES_NOT_DECLARED');
  if (unverifiedDishes(dishes).length) reasons.push('ALLERGENS_UNVERIFIED');
  const { codes, text } = checkable(client ?? NOTHING, extra);
  const found = conflicts(codes, dishes);
  if (found.length) reasons.push('ALLERGEN_CONFLICT');
  if (text.length) reasons.push('CUSTOM_ALLERGIES');
  return {
    allergyCheck: reasons.length ? ('unverified' as const) : ('verified' as const),
    allergyCheckReasons: reasons,
    allergyConflicts: found,
  };
}

/** What the batch cooker reads: each allergen once, in French, then the free text. */
export function allergyLabels(client: ClientAllergies | null, extra: string[] = []) {
  const { codes, text } = checkable(client ?? NOTHING, extra);
  return [...codes.map((code) => LABEL.get(code) ?? code), ...text];
}

/** `newer` minus what `older` already flagged, dish by dish. */
export const newConflicts = (older: Conflict[], newer: Conflict[]): Conflict[] =>
  newer
    .map((c) => {
      const known = older.find((o) => o.mealId === c.mealId)?.allergens ?? [];
      return {
        mealId: c.mealId,
        allergens: c.allergens.filter((a) => !known.includes(a)),
      };
    })
    .filter((c) => c.allergens.length > 0);

export interface DeclarationInput {
  none?: boolean;
  allergies?: string[];
  customAllergies?: string[];
  consent?: boolean;
  consentVersion?: string;
}

const invalid = (message: string) =>
  new UnprocessableEntityException({
    code: 'VALIDATION_FAILED',
    message,
    field: 'allergies',
  });

/** The columns a declaration writes. The DTO has already checked the codes. */
export function toDeclaration(input: DeclarationInput, now: Date) {
  const allergies = unique(input.allergies ?? []);
  const customAllergies = unique(
    (input.customAllergies ?? []).map((w) => w.trim()).filter(Boolean),
  );
  if (input.none) {
    if (allergies.length || customAllergies.length) {
      throw invalid('Declare "none" or a list of allergies, not both.');
    }
    return { allergies, customAllergies, allergiesNone: true, allergiesDeclaredAt: now };
  }
  if (!allergies.length && !customAllergies.length) {
    throw invalid('List at least one allergy, or declare none.');
  }
  if (!input.consent || input.consentVersion !== HEALTH_CONSENT.version) {
    throw healthConsentRequired(HEALTH_CONSENT.version);
  }
  return {
    allergies,
    customAllergies,
    allergiesNone: false,
    allergiesDeclaredAt: now,
    healthConsentAt: now,
    healthConsentVersion: HEALTH_CONSENT.version,
  };
}
