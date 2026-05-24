import { PrismaClient } from '@prisma/client';

import {
  CONCEPT_SLUG,
  DEFAULT_CONCEPT_CONTENT,
} from '../src/modules/content-cms/concept-defaults';
import { toInputJson } from './json-helpers';

const prisma = new PrismaClient();

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

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
