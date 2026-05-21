# Evolution Register - F19 Concept CMS

## Purpose

Track the evolution of files, variables, functions, routes, DTOs, entities, and tests introduced or changed for F19. Keep this document updated as implementation commits land so reviewers can understand what changed and why.

## File Evolution

| File | Status | Expected evolution |
| --- | --- | --- |
| `apps/src/modules/content-cms/content-cms.module.ts` | Done | NestJS module for F19 concept page CMS only. |
| `apps/src/modules/content-cms/content-cms.controller.ts` | Done | Controller exposing public read and admin update routes at `/content/concept`. |
| `apps/src/modules/content-cms/content-cms.service.ts` | Done | CMS read/update persistence and mapping. |
| `apps/src/modules/content-cms/concept-defaults.ts` | Done | Deterministic default concept page content. |
| `apps/src/modules/content-cms/dto/concept-content.dto.ts` | Done | Public response DTO. |
| `apps/src/modules/content-cms/dto/update-concept-content.dto.ts` | Done | Validated admin update DTO. |
| `apps/src/modules/content-cms/dto/concept-content-parts.dto.ts` | Done | Nested hero/step/block DTOs. |
| `apps/src/modules/content-cms/content-cms.service.spec.ts` | Done | Unit tests for service behavior. |
| `apps/src/modules/content-cms/content-cms.controller.spec.ts` | Done | Unit tests for route delegation. |
| `apps/src/modules/content/content.module.ts` | Done | Placeholder for general app content (not F19 CMS). |
| `apps/src/auth/admin.guard.ts` | Done | Admin authorization guard using `UserRole.ADMIN`. |
| `apps/src/auth/admin.guard.spec.ts` | Done | Unit tests for admin authorization. |
| `apps/src/supabase/entities/cms-page.entity.ts` | Done | TypeORM entity for CMS pages. |
| `apps/src/supabase/migrations/1700000000001-add-cms-pages.ts` | Done | Migration to create and seed CMS content. |
| `apps/src/integrations/supabase.service.ts` | Done | Optional Supabase client for CMS asset storage. |
| `apps/src/app.module.ts` | Done | Imports `ContentModule` and `ContentCmsModule`. |
| `apps/src/auth/auth.module.ts` | Done | Provides/exports `AdminGuard`. |
| `apps/src/supabase/database.module.ts` | Done | Registers entities and migrations via `SUPABASE_DB_URL`. |
| `apps/src/supabase/data-source.ts` | Done | TypeORM CLI data source for migrations. |
| `apps/src/supabase/entities/index.ts` | Done | Exports `CmsPage` and related types. |
| `apps/README.md` | Done | Documents F19 endpoints and local test commands. |
| `.env.example` | Done | `SUPABASE_DB_URL` and optional Supabase API keys. |
| `docs/architecture.md` | Done | Documents content vs content-cms module split. |
| `apps/src/modules/content/*` (F19 files) | Removed | F19 implementation moved to `content-cms`; general `ContentModule` kept separate. |

## Route Evolution

| Route | Status | Notes |
| --- | --- | --- |
| `GET /content/concept` | Done | Public endpoint; no `ClerkAuthGuard`. Served by `ContentCmsController`. |
| `PUT /content/concept` | Done | Admin-only endpoint; requires Clerk token and `UserRole.ADMIN`. |

## Variable And DTO Evolution

| Symbol | Status | Expected role |
| --- | --- | --- |
| `ConceptContentDto.title` | Done | Page title displayed by clients. |
| `ConceptContentDto.hero` | Done | Hero content and optional image metadata. |
| `ConceptContentDto.introBlocks` | Done | Ordered concept explanation blocks. |
| `ConceptContentDto.howItWorks` | Done | Ordered "Comment ca marche" steps. |
| `ConceptContentDto.reassuranceItems` | Done | Ordered reassurance arguments. |
| `UpdateConceptContentDto` | Done | Full replacement payload for admin saves. |
| `CmsPage.slug` | Done | Unique CMS page key; initial value `concept`. |
| `CmsPage.hero` / structured columns | Done | Persisted editable page content (jsonb columns). |
| `CmsPage.updatedByUserId` | Done | Audit pointer to last admin editor. |

## Function And Class Evolution

| Symbol | Status | Expected responsibility |
| --- | --- | --- |
| `ContentCmsController.getConcept()` | Done | Return public concept content. |
| `ContentCmsController.updateConcept()` | Done | Validate admin request and return saved concept content. |
| `ContentCmsService.getConcept()` | Done | Load the `concept` page or deterministic default. |
| `ContentCmsService.updateConcept()` | Done | Persist the admin-provided content atomically. |
| `ConceptContentDto.fromEntity()` | Done | Map `CmsPage` persistence shape to API response. |
| `AdminGuard.canActivate()` | Done | Enforce persisted admin role after Clerk authentication. |
| `SupabaseService.getClient()` | Done | Optional backing service for CMS asset uploads (future). |

## Documentation Evolution

| File | Status | Update rule |
| --- | --- | --- |
| `docs/features/f19-concept-cms.md` | Created | Update when implementation scope or API contract changes. |
| `docs/testing/f19-concept-cms-cahier-de-test.md` | Created | Update when acceptance criteria or test cases change. |
| `docs/testing/f19-concept-cms-test-execution.md` | Created | Append every execution result. |
| `docs/evolution/f19-concept-cms-evolution.md` | Updated | Restored content-cms module split (2026-05-21). |
| `docs/Revisions_followup.md` | Updated | Track F19 release candidate status. |
| `docs/architecture.md` | Done | Add content-cms module and CMS page data model. |

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-05-07 | Created F19 analysis, cahier de test, test execution, and evolution register. | Prepare implementation and qualification path for the PR feature. |
| 2026-05-21 | Implemented content module, CMS entity/migration, admin guard, tests, Supabase scaffold. | Deliver MVP F19 API per feature spec; replace `content-cms` stub. |
| 2026-05-21 | Moved F19 back to `ContentCmsModule`; kept `ContentModule` for general content; `DATABASE_URL` → `SUPABASE_DB_URL`. | Correct module boundaries and Supabase-first DB config. |
