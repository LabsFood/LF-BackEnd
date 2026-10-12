/**
 * Pure rules behind moderation after the fact (FLOW-02 §4): why content waits in
 * the review queue, what the queue flags, and what a removal reason must be.
 */

/** Why content is in the review queue, most urgent last. */
export type ReviewReason =
  | 'never-reviewed'
  | 'edited-after-review'
  | 'source-changed'
  | 'republished-after-suspension';

/** §4.3's closed list of removal reasons. */
export const MODERATION_REASON_CODES = [
  'allergens-incomplete',
  'inappropriate-content',
  'copyright',
  'misleading-origin',
  'duplicate',
  'quality',
  'other',
];

/** §4.3: shown verbatim to the chef, so it must say something. */
export const REASON_LENGTH = { min: 15, max: 500 };

export const isValidReason = (reason: unknown): reason is string =>
  typeof reason === 'string' &&
  reason.trim().length >= REASON_LENGTH.min &&
  reason.trim().length <= REASON_LENGTH.max;

/**
 * The review reason a change sets, given what the content was. Content already
 * waiting keeps the reason it has, except that a republication after suspension
 * always wins: an admin must look at what was taken down and came back.
 */
export function nextReviewReason(
  current: { reviewReason: string | null; reviewedAt: Date | null },
  event: 'published' | 'republished-after-suspension' | 'edited',
): ReviewReason | null {
  if (event === 'republished-after-suspension') return 'republished-after-suspension';
  if (current.reviewReason) return current.reviewReason as ReviewReason;
  if (!current.reviewedAt) return 'never-reviewed';
  return event === 'edited' ? 'edited-after-review' : null;
}

/**
 * The columns that put content in the review queue for `reason`, or nothing when
 * it needs no look. Content already waiting for the same reason keeps its place.
 */
export function reviewFields(
  current: { reviewReason: string | null; reviewPendingSince: Date | null },
  reason: ReviewReason | null,
  now: Date,
): { reviewReason?: ReviewReason; reviewPendingSince?: Date } {
  if (!reason) return {};
  const keepsPlace = current.reviewReason === reason && current.reviewPendingSince;
  return {
    reviewReason: reason,
    reviewPendingSince: keepsPlace ? current.reviewPendingSince! : now,
  };
}

/** What republishing clears: the removal was answered by the correction. */
export const CLEARED_MODERATION = {
  moderationReason: null,
  moderationReasonCode: null,
  moderatedAt: null,
};

/** §4.1's flags: what deserves a look in a queue item. */
export function reviewFlags(item: {
  reviewReason: string | null;
  customAllergens?: string[];
  customDiets?: string[];
  allergensNone?: boolean;
}): string[] {
  const flags: string[] = [];
  if (item.customAllergens?.length) flags.push('custom-allergen');
  if (item.customDiets?.length) flags.push('custom-diet');
  if (item.allergensNone) flags.push('no-allergens-declared');
  if (item.reviewReason && item.reviewReason !== 'never-reviewed') {
    flags.push(item.reviewReason);
  }
  return flags;
}

/**
 * Free-text values chefs typed, counted case- and accent-insensitively, most
 * frequent first: the ones worth adding to the reference lists (§3.1).
 */
export function recurringValues(values: string[]): { value: string; count: number }[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}
