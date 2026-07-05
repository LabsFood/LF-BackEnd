import { DEMO_SEED_TAG } from '../../prisma/demo-seed-constants';

/** Clerk user ids issued by Clerk (e.g. `user_2abc…`). */
const CLERK_USER_ID_PATTERN = /^user_[a-zA-Z0-9]+$/;

const CLERK_LOCAL_STUB_SECRET = 'sk_test_placeholder';

const CLERK_SECRET_KEY_PATTERN = /^sk_(test|live)_[a-zA-Z0-9]+$/;

export function isRealClerkUserId(clerkUserId: string): boolean {
  return CLERK_USER_ID_PATTERN.test(clerkUserId);
}

/** Rows seeded locally or pre-Clerk migration targets for `db:sync:clerk`. */
export function isPlaceholderClerkUserId(clerkUserId: string): boolean {
  if (clerkUserId.startsWith(`${DEMO_SEED_TAG}_`)) return true;
  return !isRealClerkUserId(clerkUserId);
}

export function isRealClerkSecretKey(secret: string | undefined): boolean {
  if (!secret || secret === CLERK_LOCAL_STUB_SECRET) return false;
  return CLERK_SECRET_KEY_PATTERN.test(secret);
}

export function splitFullName(fullName: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  if (!fullName?.trim()) return {};
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
