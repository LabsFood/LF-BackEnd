import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import {
  CONCEPT_SLUG,
  DEFAULT_CONCEPT_CONTENT,
} from '../src/modules/content-cms/concept-defaults';
import { toInputJson } from './json-helpers';

loadRepoEnv();

const migrationUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
if (!migrationUrl) {
  throw new Error('SUPABASE_DB_URL is required to run the seed.');
}

const { prisma, pool } = createPrismaClient(migrationUrl);

async function main(): Promise<void> {
  await prisma.cmsPage.upsert({
    where: { slug: CONCEPT_SLUG },
    create: {
      slug: CONCEPT_SLUG,
      title: DEFAULT_CONCEPT_CONTENT.title,
      hero: toInputJson(DEFAULT_CONCEPT_CONTENT.hero),
      introBlocks: toInputJson(DEFAULT_CONCEPT_CONTENT.introBlocks),
      howItWorks: toInputJson(DEFAULT_CONCEPT_CONTENT.howItWorks),
      reassuranceItems: toInputJson(DEFAULT_CONCEPT_CONTENT.reassuranceItems),
      status: 'published',
    },
    update: {},
  });
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
