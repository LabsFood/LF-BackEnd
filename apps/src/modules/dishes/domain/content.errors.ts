import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PublishProblem } from './dishes.rules';

/**
 * FLOW-02 §8: a write on a dish or menu the caller does not own. The same code
 * answers a chef touching another chef's content and an admin reaching a chef's
 * dish through the legacy Lab's Food routes.
 */
export const contentNotOwned = (
  message = 'This content belongs to someone else.',
): ForbiddenException => new ForbiddenException({ code: 'CONTENT_NOT_OWNED', message });

/**
 * FLOW-02 §3.3 and FLOW-01's browse-only rule: a batch cooker whose candidature is
 * not approved, or whose dossier is no longer validated, cannot write or publish.
 */
export const chefNotVerified = (message: string): ForbiddenException =>
  new ForbiddenException({ code: 'CHEF_NOT_VERIFIED', message });

/** Publishing Lab's Food content that is still offered to one chef. */
export const offerPending = (): ConflictException =>
  new ConflictException({
    code: 'OFFER_PENDING',
    message:
      'This is offered to a batch cooker and cannot be published. Withdraw the offer ' +
      'first.',
  });

/** A write whose result would contradict itself, or a publication check that fails. */
export const validationFailed = (
  message: string,
  details?: Record<string, unknown>,
): UnprocessableEntityException =>
  new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message, ...details });

// The Recettes contract (PRD v2.0, lots 0 to 5). The fronts choose the popover text
// from `code`, never from `message`, and read the details named here. Each lot
// throws its own; the lot 6 codes come with lot 6.

/** The client never answered the allergy question (a list or "none", with consent). */
export const allergiesNotDeclared = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'ALLERGIES_NOT_DECLARED',
    message: 'Declare allergies, or none, before validating a menu.',
  });

/** A chosen dish contains an allergen the client declared. */
export const allergenConflict = (
  conflicts: { mealId: string; allergens: string[] }[],
): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'ALLERGEN_CONFLICT',
    message: 'A dish contains a declared allergen.',
    conflicts,
  });

/** A chosen dish has no verified allergens, so it cannot be checked. */
export const allergensUnverified = (mealIds: string[]): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'ALLERGENS_UNVERIFIED',
    message: 'A dish has no verified allergens.',
    mealIds,
  });

/** Allergies listed without consent to the current text (missing, refused or outdated). */
export const healthConsentRequired = (version: string): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'HEALTH_CONSENT_REQUIRED',
    message: 'Accept the current consent text to record allergies.',
    version,
  });

/** Publishing a recipe that is not ready: every problem at once. */
export const recipeNotReady = (
  problems: PublishProblem[],
): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'RECIPE_NOT_READY',
    message: 'This recipe is not ready to publish.',
    problems,
  });

/** Changing the dishes of a menu less than three days before the prestation. */
export const menuFrozen = (frozenSince: Date): ConflictException =>
  new ConflictException({
    code: 'MENU_FROZEN',
    message: 'The menu is frozen three days before the prestation.',
    frozenSince,
  });

/** The client acts on a shopping list the batch cooker has not sent yet. */
export const shoppingListNotSent = (): ConflictException =>
  new ConflictException({
    code: 'SHOPPING_LIST_NOT_SENT',
    message: 'The batch cooker has not sent the shopping list yet.',
  });

/** The client changes or resends the list after the deadline (noon the day before). */
export const shoppingListFrozen = (frozenSince: Date): ConflictException =>
  new ConflictException({
    code: 'SHOPPING_LIST_FROZEN',
    message: 'The shopping list is frozen.',
    frozenSince,
  });

/**
 * The client answers a list the batch cooker has sent again since it was opened:
 * their marks would land on other quantities. `version` is the one to reload.
 */
export const shoppingListUpdated = (version: number): ConflictException =>
  new ConflictException({
    code: 'SHOPPING_LIST_UPDATED',
    message: 'The batch cooker has updated the shopping list since you opened it.',
    version,
  });

/** Sending or answering a list when the client does the shopping (§10.7, case 2). */
export const shoppingByClient = (): ConflictException =>
  new ConflictException({
    code: 'SHOPPING_BY_CLIENT',
    message:
      'The client does the shopping for this prestation: no list goes back and forth.',
  });

/** A cap is reached: ingredients, steps, AI generations. */
export const limitReached = (limit: string, max: number): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'LIMIT_REACHED',
    message: `At most ${max} ${limit}.`,
    limit,
    max,
  });

/** The generated recipe still breaks the standard format after the last retry. */
export const aiFormatInvalid = (attempts: number): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'AI_FORMAT_INVALID',
    message: 'The generated recipe does not follow the standard format.',
    attempts,
  });

/** Reserved: publishing refused for the chef's tier, once that rule is decided. */
export const tierCannotPublish = (tier: string): ForbiddenException =>
  new ForbiddenException({
    code: 'TIER_CANNOT_PUBLISH',
    message: 'This tier cannot publish.',
    tier,
  });

/** The recipe changed since the chef opened it; `lockVersion` is the one to reload. */
export const recipeConflict = (lockVersion: number): ConflictException =>
  new ConflictException({
    code: 'RECIPE_CONFLICT',
    message: 'The recipe was changed since you opened it.',
    lockVersion,
  });

/** Lines of a recipe that name the same ingredient: each inner list is one group (R10). */
export const duplicateIngredientLine = (
  lines: number[][],
): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'DUPLICATE_INGREDIENT_LINE',
    message: 'The same ingredient appears on several lines.',
    lines,
  });

/** Lines that still point at no entry of the common ingredient list. */
export const ingredientNotLinked = (lines: number[]): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'INGREDIENT_NOT_LINKED',
    message: 'Some ingredients are not linked to the common list.',
    lines,
  });

/** The chef created too many ingredients in a short time. */
export const ingredientCapReached = (): HttpException =>
  new HttpException(
    {
      code: 'INGREDIENT_CAP_REACHED',
      message: 'Too many ingredients created: try again later.',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
