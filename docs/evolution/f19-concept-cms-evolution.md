# Evolution Register - F19 Concept CMS

## Purpose

Track the evolution of files, variables, functions, routes, DTOs, entities, and tests introduced or changed for F19. Keep this document updated as implementation commits land so reviewers can understand what changed and why.

## File Evolution

| File | Status | Expected evolution |
| --- | --- | --- |
| `apps/api-nestjs/src/modules/content/content.module.ts` | Planned | New NestJS module for the CMS content feature. |
| `apps/api-nestjs/src/modules/content/content.controller.ts` | Planned | New controller exposing public read and admin update routes. |
| `apps/api-nestjs/src/modules/content/content.service.ts` | Planned | New service for CMS read/update persistence and mapping. |
| `apps/api-nestjs/src/modules/content/dto/concept-content.dto.ts` | Planned | New public response DTO. |
| `apps/api-nestjs/src/modules/content/dto/update-concept-content.dto.ts` | Planned | New validated admin update DTO. |
| `apps/api-nestjs/src/modules/content/content.service.spec.ts` | Planned | New unit tests for service behavior. |
| `apps/api-nestjs/src/modules/content/content.controller.spec.ts` | Planned | New unit tests for route behavior. |
| `apps/api-nestjs/src/auth/admin.guard.ts` | Planned | New admin authorization guard using `UserRole.ADMIN`. |
| `apps/api-nestjs/src/auth/admin.guard.spec.ts` | Planned | New unit tests for admin authorization. |
| `apps/api-nestjs/src/database/entities/cms-page.entity.ts` | Planned | New TypeORM entity for CMS pages. |
| `apps/api-nestjs/src/database/migrations/<timestamp>-add-cms-pages.ts` | Planned | New migration to create and seed CMS content. |
| `apps/api-nestjs/src/app.module.ts` | Planned update | Import `ContentModule`. |
| `apps/api-nestjs/src/auth/auth.module.ts` | Planned update | Provide/export `AdminGuard` if implemented in `auth/`. |
| `apps/api-nestjs/src/database/database.module.ts` | Planned update | Register CMS entity and migration. |
| `apps/api-nestjs/src/database/data-source.ts` | Planned update | Register CMS entity and migration for CLI operations if required. |
| `apps/api-nestjs/src/database/entities/index.ts` | Planned update | Export `CmsPage`. |
| `apps/api-nestjs/README.md` | Planned update | Document F19 endpoints and local test commands. |
| `docs/architecture.md` | Planned update | Add content module and CMS page data model after implementation. |

## Route Evolution

| Route | Status | Notes |
| --- | --- | --- |
| `GET /content/concept` | Planned | Public endpoint; no `ClerkAuthGuard`. |
| `PUT /content/concept` | Planned | Admin-only endpoint; requires Clerk token and `UserRole.ADMIN`. |

## Variable And DTO Evolution

| Symbol | Status | Expected role |
| --- | --- | --- |
| `ConceptContentDto.title` | Planned | Page title displayed by clients. |
| `ConceptContentDto.hero` | Planned | Hero content and optional image metadata. |
| `ConceptContentDto.introBlocks` | Planned | Ordered concept explanation blocks. |
| `ConceptContentDto.howItWorks` | Planned | Ordered "Comment ca marche" steps. |
| `ConceptContentDto.reassuranceItems` | Planned | Ordered reassurance arguments. |
| `UpdateConceptContentDto` | Planned | Full replacement payload for admin saves. |
| `CmsPage.slug` | Planned | Unique CMS page key; initial value `concept`. |
| `CmsPage.content` or structured columns | Planned | Persisted editable page content. |
| `CmsPage.updatedByUserId` | Planned | Audit pointer to last admin editor. |

## Function And Class Evolution

| Symbol | Status | Expected responsibility |
| --- | --- | --- |
| `ContentController.getConcept()` | Planned | Return public concept content. |
| `ContentController.updateConcept()` | Planned | Validate admin request and return saved concept content. |
| `ContentService.getConcept()` | Planned | Load the `concept` page or deterministic default. |
| `ContentService.updateConcept()` | Planned | Persist the admin-provided content atomically. |
| `ConceptContentDto.fromEntity()` | Planned | Map `CmsPage` persistence shape to API response. |
| `AdminGuard.canActivate()` | Planned | Enforce persisted admin role after Clerk authentication. |

## Documentation Evolution

| File | Status | Update rule |
| --- | --- | --- |
| `docs/features/f19-concept-cms.md` | Created | Update when implementation scope or API contract changes. |
| `docs/testing/f19-concept-cms-cahier-de-test.md` | Created | Update when acceptance criteria or test cases change. |
| `docs/testing/f19-concept-cms-test-execution.md` | Created | Append every execution result. |
| `docs/evolution/f19-concept-cms-evolution.md` | Created | Update each time files, variables, functions, or routes are added/renamed/removed. |
| `docs/Revisions_followup.md` | Updated | Track F19 release candidate status. |

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-05-07 | Created F19 analysis, cahier de test, test execution, and evolution register. | Prepare implementation and qualification path for the PR feature. |
