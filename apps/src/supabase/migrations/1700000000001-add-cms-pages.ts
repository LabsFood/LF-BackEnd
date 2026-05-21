import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  DEFAULT_CONCEPT_CONTENT,
  CONCEPT_SLUG,
} from '../../modules/content-cms/concept-defaults';

export class AddCmsPages1700000000001 implements MigrationInterface {
  name = 'AddCmsPages1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cms_pages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slug" varchar(255) NOT NULL,
        "title" varchar(255) NOT NULL,
        "hero" jsonb NOT NULL,
        "intro_blocks" jsonb NOT NULL,
        "how_it_works" jsonb NOT NULL,
        "reassurance_items" jsonb NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'published',
        "updated_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_cms_pages_slug" UNIQUE ("slug"),
        CONSTRAINT "fk_cms_pages_updated_by_user_id" FOREIGN KEY ("updated_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    const seed = DEFAULT_CONCEPT_CONTENT;
    await queryRunner.query(
      `
        INSERT INTO "cms_pages" (
          "slug", "title", "hero", "intro_blocks", "how_it_works", "reassurance_items", "status"
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, 'published')
      `,
      [
        CONCEPT_SLUG,
        seed.title,
        JSON.stringify(seed.hero),
        JSON.stringify(seed.introBlocks),
        JSON.stringify(seed.howItWorks),
        JSON.stringify(seed.reassuranceItems),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cms_pages"`);
  }
}
