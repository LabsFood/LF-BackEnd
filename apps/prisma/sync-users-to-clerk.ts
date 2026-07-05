/**
 * One-off admin process: create Clerk users for DB rows with placeholder clerk_user_id
 * (demo seed tags or non-`user_…` ids) and persist the real Clerk id on `users`.
 *
 * Requires a real CLERK_SECRET_KEY for both write and dry-run (dry-run queries Clerk).
 * Never logs secrets.
 */
import { createClerkClient } from '@clerk/backend';

import { isPlaceholderClerkUserId, isRealClerkSecretKey, splitFullName } from '../src/auth/clerk-ids';
import { normalizeEmailForClerk } from './demo-seed-constants';
import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

loadRepoEnv();

const dryRun = process.argv.includes('--dry-run');

const migrationUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
if (!migrationUrl) {
  throw new Error('SUPABASE_DB_URL is required to sync users to Clerk.');
}

const clerkSecret = process.env.CLERK_SECRET_KEY;
if (!isRealClerkSecretKey(clerkSecret)) {
  throw new Error(
    'Set a real CLERK_SECRET_KEY (sk_test_… or sk_live_…) in repo-root .env — ' +
      'https://dashboard.clerk.com/~/api-keys . ' +
      'sk_test_placeholder is for local JWT decode only. ' +
      'If you exported CLERK_SECRET_KEY in your shell, run: unset CLERK_SECRET_KEY',
  );
}

const { prisma, pool } = createPrismaClient(migrationUrl);
const clerk = createClerkClient({ secretKey: clerkSecret! });

async function assertClerkReachable(): Promise<void> {
  try {
    await clerk.users.getCount();
  } catch {
    throw new Error(
      'Could not reach Clerk with CLERK_SECRET_KEY. Check the key and network, then retry.',
    );
  }
}

async function previewClerkUser(email: string): Promise<string> {
  const { data } = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });
  const existing = data[0];
  if (existing) {
    return `link existing Clerk user ${existing.id}`;
  }
  return 'create new Clerk user';
}

async function main(): Promise<void> {
  await assertClerkReachable();

  const candidates = await prisma.user.findMany({
    where: {},
    orderBy: { createdAt: 'asc' },
  });

  const toSync = candidates.filter((row) => isPlaceholderClerkUserId(row.clerkUserId));
  console.log(
    dryRun
      ? `[dry-run] Would sync ${toSync.length} user(s) to Clerk (Clerk API checked).`
      : `Syncing ${toSync.length} user(s) to Clerk…`,
  );

  for (const row of toSync) {
    const { firstName, lastName } = splitFullName(row.fullName);
    const clerkEmail = normalizeEmailForClerk(row.email);
    if (clerkEmail !== row.email) {
      await prisma.user.update({
        where: { id: row.id },
        data: { email: clerkEmail },
      });
      console.log(`  normalized email ${row.email} → ${clerkEmail}`);
    }

    if (dryRun) {
      const action = await previewClerkUser(clerkEmail);
      console.log(
        `  [dry-run] ${clerkEmail} (${row.clerkUserId}) → ${action}`,
      );
      continue;
    }

    const existing = await clerk.users.getUserList({
      emailAddress: [clerkEmail],
      limit: 1,
    });
    const clerkUser =
      existing.data[0] ??
      (await clerk.users.createUser({
        emailAddress: [clerkEmail],
        firstName,
        lastName,
        skipPasswordRequirement: true,
      }));

    await prisma.user.update({
      where: { id: row.id },
      data: { clerkUserId: clerkUser.id },
    });
    const verb = existing.data[0] ? 'linked' : 'created';
    console.log(`  ${clerkEmail}: ${row.clerkUserId} → ${clerkUser.id} (${verb})`);
  }
}

async function shutdown(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}

main()
  .then(() => shutdown())
  .catch(async (error: unknown) => {
    console.error(error);
    await shutdown();
    process.exit(1);
  });
