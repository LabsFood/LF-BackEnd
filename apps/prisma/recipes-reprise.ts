/**
 * One-off admin process, Recettes §9: the reprise of the existing dishes.
 *
 * Run it once the common ingredient list is imported and reviewed on the target
 * database (Recettes §12): first as a dry run, to complete the list with the names
 * it could not link, then for real. For every meal (chefs' dishes, Lab's Food
 * recipes and offers), the current content only:
 *   1. `normalized_name` is filled on the entries that lack it;
 *   2. each unlinked line is linked when its name, normalized, is the name or another
 *      name of exactly one active common entry (never by approximation); otherwise it
 *      goes to verification with its original words;
 *   3. free-text units are converted, the allergens declared by hand are kept as
 *      added, the lines are stamped and the allergens recomputed, `lockVersion` +1;
 *   4. a verified dish that gains an allergen loses its verification, and its chef
 *      gets `recipe_allergens_changed`;
 *   5. each chef concerned gets `recipes_migrated` once, and an e-mail.
 * No allergen is ever lost. Statuses, publication, versions and bookings are not
 * touched. Run again, it changes nothing. The logic and its tests live in
 * `src/modules/dishes/reprise.runner.ts`.
 *
 * Options:
 *   --dry-run   report what would change; writes and sends nothing
 *   --yes       required to actually write
 */
import { ConfigService } from '@nestjs/config';

import { configLoader } from '../src/config/config.loader';
import { loadRepoEnv } from '../src/config/env-files';
import { BrevoService } from '../src/integrations/brevo.service';
import { DishesMailer } from '../src/modules/dishes/dishes.mailer';
import { formatReport, runReprise } from '../src/modules/dishes/reprise.runner';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

loadRepoEnv();

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
// Fail safe: anything short of an explicit --yes is a dry run, so a mistyped or
// mis-targeted invocation reports instead of writing.
const dryRun = argv.includes('--dry-run') || !confirmed;

/** Usage/config problems, reported without a stack trace. */
class UsageError extends Error {}

const USAGE = `
Usage: npm run db:recipes:reprise -- [--yes]
       npm run db:recipes:reprise:dry

Options:
  --dry-run   report what would change, without writing or sending anything
  --yes       required to actually write (see below)

Writes require --yes. Without it the script runs as a dry run and prints the
target database host, so you can confirm you are not pointed at production by
accident. Note that repo-root .env.local OVERRIDES shell-exported variables,
so exporting SUPABASE_DB_URL on the command line does NOT redirect this script.
Run it only once the common ingredient list is imported and reviewed there.
`.trim();

function validateArgs(): { dbUrl: string } {
  const unknown = argv.filter((arg) => arg !== '--yes' && arg !== '--dry-run');
  if (unknown.length) {
    throw new UsageError(`Unknown argument(s): ${unknown.join(' ')}.\n\n${USAGE}`);
  }
  const dbUrl =
    process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
  if (!dbUrl) {
    throw new UsageError('SUPABASE_DB_URL is required to run the reprise.');
  }
  return { dbUrl };
}

// Assigned in main() once arguments and environment validate.
let prisma: ReturnType<typeof createPrismaClient>['prisma'];
let pool: ReturnType<typeof createPrismaClient>['pool'];

async function main(): Promise<void> {
  const { dbUrl } = validateArgs();

  // Always say where the writes would land — the env precedence in this repo makes
  // it easy to believe you are on localhost while pointed at hosted Postgres.
  const target = new URL(dbUrl);
  console.log(`Database : ${target.hostname}${target.pathname}`);
  console.log(
    `Mode     : ${dryRun ? 'DRY RUN (no writes, no notification, no e-mail)' : 'WRITE'}`,
  );
  if (dryRun && !argv.includes('--dry-run')) {
    console.log('           (no --yes flag, so nothing will be written)');
  }

  // Recettes §5.5: the e-mails go through Brevo, as the API sends them. Unconfigured,
  // each one is a logged no-op: the notifications in the app still reach the chefs.
  const config = new ConfigService(configLoader());
  const brevo = new BrevoService(config);
  const mailer = new DishesMailer(brevo, config);
  const missing = [
    !brevo.configured && 'BREVO_API_KEY',
    !brevo.templates.recipesMigrated && 'BREVO_TPL_RECIPES_MIGRATED',
    !brevo.templates.recipeAllergensChanged && 'BREVO_TPL_RECIPE_ALLERGENS_CHANGED',
  ].filter(Boolean);
  if (missing.length) {
    console.warn(
      `E-mails  : NOT SENT, ${missing.join(', ')} missing. Chefs still get the in-app ` +
        'notification, and a rerun will not e-mail them later.',
    );
  }
  console.log('');

  ({ prisma, pool } = createPrismaClient(dbUrl));
  const report = await runReprise(prisma, mailer, {
    dryRun,
    log: (line) => console.log(line),
  });

  console.log('');
  for (const line of formatReport(report))
    console.log(`${dryRun ? '[dry-run] ' : ''}${line}`);
}

async function shutdown(): Promise<void> {
  // May not exist yet if validation failed before the client was built.
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
