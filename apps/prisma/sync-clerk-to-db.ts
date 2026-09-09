/**
 * One-off admin process: pull users **from Clerk into Postgres**.
 *
 * This is the opposite direction to `sync-users-to-clerk.ts` (DB → Clerk). Use it when a
 * Clerk account exists with no matching `users` row — typically an account created before
 * the webhook was configured, or one that has never hit `GET /me`.
 *
 * Selectors (exactly one required):
 *   --email <address>      one user, looked up by Clerk email
 *   --clerk-id <user_…>    one user, looked up by Clerk id
 *   --all                  every Clerk user missing from Postgres
 *
 * Options:
 *   --dry-run              report what would change; writes nothing
 *   --role <client|chef|admin>
 *                          role to set. On create, defaults to `client`.
 *                          On an existing row, the role is left untouched unless
 *                          this flag is passed.
 *
 * Requires a real CLERK_SECRET_KEY for both write and dry-run. Never logs secrets.
 */
import type { User as ClerkUser } from '@clerk/backend';
import { createClerkClient } from '@clerk/backend';

import { isRealClerkSecretKey } from '../src/auth/clerk-ids';
import { clerkProfileFromBapiUser } from '../src/auth/clerk-user-payload';
import { loadRepoEnv } from '../src/config/env-files';
import { UserRole } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

loadRepoEnv();

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
// Fail safe: anything short of an explicit --yes is a dry run, so a mistyped or
// mis-targeted invocation reports instead of writing.
const dryRun = argv.includes('--dry-run') || !confirmed;

function flagValue(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const emailArg = flagValue('--email');
const clerkIdArg = flagValue('--clerk-id');
const syncAll = argv.includes('--all');
const roleArg = flagValue('--role');

/** Usage/config problems, reported without a stack trace. */
class UsageError extends Error {}

const USAGE = `
Usage: npm run db:backfill:clerk -- <selector> [options]
       npm run db:backfill:clerk:dry -- <selector> [options]

Selectors (exactly one):
  --email <address>       one user, looked up by Clerk email
  --clerk-id <user_…>     one user, looked up by Clerk id
  --all                   every Clerk user missing from Postgres

Options:
  --role <client|chef|admin>   role to set (default on create: client;
                               existing rows keep their role unless passed)
  --dry-run                    report changes without writing
  --yes                        required to actually write (see below)

Writes require --yes. Without it the script runs as a dry run and prints the
target database host, so you can confirm you are not pointed at production by
accident. Note that repo-root .env.local OVERRIDES shell-exported variables,
so exporting SUPABASE_DB_URL on the command line does NOT redirect this script.
`.trim();

function validateArgs(): {
  requestedRole?: UserRole;
  dbUrl: string;
  clerkSecret: string;
} {
  const selectorCount = [emailArg, clerkIdArg, syncAll ? 'all' : undefined].filter(
    Boolean,
  ).length;
  if (selectorCount !== 1) {
    throw new UsageError(
      `Pass exactly one selector: --email <address>, --clerk-id <user_…>, or --all.\n\n${USAGE}`,
    );
  }

  if (roleArg && !Object.values(UserRole).includes(roleArg as UserRole)) {
    throw new UsageError(
      `Invalid --role "${roleArg}". Expected one of: ${Object.values(UserRole).join(', ')}.`,
    );
  }

  const dbUrl =
    process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
  if (!dbUrl) {
    throw new UsageError(
      'SUPABASE_DB_URL is required to sync Clerk users into Postgres.',
    );
  }

  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (!isRealClerkSecretKey(clerkSecret)) {
    throw new UsageError(
      'Set a real CLERK_SECRET_KEY (sk_test_… or sk_live_…) in repo-root .env — ' +
        'https://dashboard.clerk.com/~/api-keys . ' +
        'sk_test_placeholder is for local JWT decode only. ' +
        'If you exported CLERK_SECRET_KEY in your shell, run: unset CLERK_SECRET_KEY',
    );
  }

  return {
    requestedRole: roleArg as UserRole | undefined,
    dbUrl,
    clerkSecret: clerkSecret!,
  };
}

// Assigned in main() once arguments and environment validate.
let prisma: ReturnType<typeof createPrismaClient>['prisma'];
let pool: ReturnType<typeof createPrismaClient>['pool'];
let clerk: ReturnType<typeof createClerkClient>;
let requestedRole: UserRole | undefined;

async function resolveClerkUsers(): Promise<ClerkUser[]> {
  if (clerkIdArg) {
    return [await clerk.users.getUser(clerkIdArg)];
  }

  if (emailArg) {
    const { data } = await clerk.users.getUserList({
      emailAddress: [emailArg],
      limit: 1,
    });
    if (data.length === 0) {
      throw new Error(`No Clerk user found for email ${emailArg}.`);
    }
    return data;
  }

  // --all: page through the whole Clerk instance.
  const all: ClerkUser[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data } = await clerk.users.getUserList({ limit, offset });
    all.push(...data);
    if (data.length < limit) break;
  }
  return all;
}

interface SyncOutcome {
  created: number;
  updated: number;
  skipped: number;
}

async function syncOne(clerkUser: ClerkUser, outcome: SyncOutcome): Promise<void> {
  const profile = clerkProfileFromBapiUser(clerkUser);
  const label = profile.email ?? clerkUser.id;

  if (!profile.email) {
    console.warn(
      `  skip ${clerkUser.id}: Clerk account has no email address (users.email is NOT NULL).`,
    );
    outcome.skipped += 1;
    return;
  }

  const byClerkId = await prisma.user.findUnique({
    where: { clerkUserId: clerkUser.id },
  });

  if (byClerkId) {
    const data: {
      email?: string;
      fullName?: string | null;
      phone?: string | null;
      role?: UserRole;
    } = {};
    if (profile.email !== byClerkId.email) data.email = profile.email;
    if (profile.fullName !== byClerkId.fullName) data.fullName = profile.fullName ?? null;
    if (profile.phone !== byClerkId.phone) data.phone = profile.phone ?? null;
    // Existing rows keep their role unless --role was passed explicitly.
    if (requestedRole && requestedRole !== byClerkId.role) data.role = requestedRole;

    if (Object.keys(data).length === 0) {
      console.log(`  ${label}: already in sync (${byClerkId.id})`);
      outcome.skipped += 1;
      return;
    }

    if (dryRun) {
      console.log(`  [dry-run] ${label}: would update ${Object.keys(data).join(', ')}`);
      outcome.updated += 1;
      return;
    }

    const updated = await prisma.user.update({ where: { id: byClerkId.id }, data });
    console.log(`  ${label}: updated ${Object.keys(data).join(', ')} (${updated.id})`);
    outcome.updated += 1;
    return;
  }

  // No row for this Clerk id. Guard the email unique constraint before inserting:
  // a row under a different clerk_user_id means the two records disagree, and a blind
  // insert would fail on uq_users_email.
  const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
  if (byEmail) {
    console.error(
      `  CONFLICT ${label}: users row ${byEmail.id} already holds this email under ` +
        `clerk_user_id "${byEmail.clerkUserId}", but Clerk says "${clerkUser.id}". ` +
        'Resolve manually — most likely the row predates Clerk and needs its ' +
        'clerk_user_id corrected to the Clerk value.',
    );
    outcome.skipped += 1;
    return;
  }

  const role = requestedRole ?? UserRole.client;

  if (dryRun) {
    console.log(`  [dry-run] ${label}: would create users row (role ${role})`);
    outcome.created += 1;
    return;
  }

  const created = await prisma.user.create({
    data: {
      clerkUserId: clerkUser.id,
      email: profile.email,
      fullName: profile.fullName ?? null,
      phone: profile.phone ?? null,
      role,
    },
  });
  console.log(`  ${label}: created users row ${created.id} (role ${role})`);
  outcome.created += 1;
}

async function main(): Promise<void> {
  const validated = validateArgs();
  requestedRole = validated.requestedRole;
  ({ prisma, pool } = createPrismaClient(validated.dbUrl));
  clerk = createClerkClient({ secretKey: validated.clerkSecret });

  try {
    await clerk.users.getCount();
  } catch {
    throw new UsageError(
      'Could not reach Clerk with CLERK_SECRET_KEY. Check the key and network, then retry.',
    );
  }

  // Always say where the writes would land — the env precedence in this repo makes
  // it easy to believe you are on localhost while pointed at hosted Postgres.
  const target = new URL(validated.dbUrl);
  console.log(`Database : ${target.hostname}${target.pathname}`);
  console.log(`Mode     : ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);
  if (dryRun && !argv.includes('--dry-run')) {
    console.log('           (no --yes flag, so nothing will be written)');
  }
  console.log('');

  const clerkUsers = await resolveClerkUsers();
  console.log(
    dryRun
      ? `[dry-run] Checking ${clerkUsers.length} Clerk user(s) against Postgres…`
      : `Syncing ${clerkUsers.length} Clerk user(s) into Postgres…`,
  );

  const outcome: SyncOutcome = { created: 0, updated: 0, skipped: 0 };
  for (const clerkUser of clerkUsers) {
    await syncOne(clerkUser, outcome);
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}Done — ` +
      `${outcome.created} created, ${outcome.updated} updated, ${outcome.skipped} skipped.`,
  );
}

async function shutdown(): Promise<void> {
  // May not exist yet if validation failed before the clients were built.
  await prisma?.$disconnect();
  await pool?.end();
}

main()
  .then(() => shutdown())
  .catch(async (error: unknown) => {
    // Usage and config problems get a plain message; anything else keeps its stack.
    if (error instanceof UsageError) {
      console.error(`\n${error.message}\n`);
    } else {
      console.error(error);
    }
    await shutdown();
    process.exit(1);
  });
