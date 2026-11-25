/**
 * Recettes lot 3 (LF-0269, R40): the menu of a prestation is frozen 72 hours
 * before it starts. Computed from `startsAt`, never stored nor scheduled: a
 * booking moved further out thaws by itself. Fixed in this release (not a setting).
 */
export const MENU_FREEZE_HOURS = 72;

/** When the menu of a prestation starting at `startsAt` freezes. */
export const frozenSince = (startsAt: Date): Date =>
  new Date(startsAt.getTime() - MENU_FREEZE_HOURS * 3_600_000);

/** True from 72 hours before the start: the dishes no longer change (`MENU_FROZEN`). */
export const isMenuFrozen = (startsAt: Date, now: Date = new Date()): boolean =>
  now.getTime() >= frozenSince(startsAt).getTime();

/** What a booking view exposes: `menuFrozen` and `frozenSince`. */
export const menuFreeze = (startsAt: Date, now: Date = new Date()) => ({
  menuFrozen: isMenuFrozen(startsAt, now),
  frozenSince: frozenSince(startsAt),
});
