# F19 - Page "Notre Concept" CMS

## Feature Source

- PR title: `14 feat710/page concept contenu cms`
- PR description: `F19: Page "Notre Concept" - contenu CMS`
- User stories:
  - Visitor reads the public "Notre Concept" page explaining Labs Food, value proposition, and the MVP service flow through `GET /content/concept`.
  - Admin edits text blocks, titles, and images without a deployment through `PUT /content/concept`.
  - Visitor sees a "Comment ca marche" section with illustrated key steps: menu choice, booking, home service.
  - Visitor sees reassurance arguments: hygiene, professional chef, personalization.

## Current Codebase Finding

The current API has no `content`, `cms`, or `concept` module. Existing public routes are limited to health/readiness, while business routes use `ClerkAuthGuard`.

Relevant baseline files:

| Area | Existing files | Current role |
| --- | --- | --- |
| API root wiring | `apps/api-nestjs/src/app.module.ts` | Imports existing modules. Add the new content module here. |
| Database wiring | `apps/api-nestjs/src/database/database.module.ts` | Registers TypeORM entities and migrations explicitly. Add CMS entities and migrations here. |
| Entity exports | `apps/api-nestjs/src/database/entities/index.ts` | Re-exports database entities. Add CMS entity exports here. |
| Auth | `apps/api-nestjs/src/auth/clerk-auth.guard.ts` | Decodes Clerk JWT payload and attaches `clerkUser`. Public GET should not use it; admin PUT should. |
| User role source | `apps/api-nestjs/src/database/entities/user.entity.ts` | Defines `UserRole.ADMIN`, but no admin guard exists yet. |
| User lookup | `apps/api-nestjs/src/modules/users/users.service.ts` | Provides persisted users and exported `UsersService`. Reuse for admin role checks. |
| Public route pattern | `apps/api-nestjs/src/modules/health/health.controller.ts` | Shows unauthenticated controller methods. |
| Feature module pattern | `apps/api-nestjs/src/modules/bookings/*` | Shows module/controller/service/DTO structure and Swagger decorators. |
| Migration baseline | `apps/api-nestjs/src/database/migrations/1700000000000-init.ts` | Initial schema. Add a new migration rather than editing this one. |

## Recommended Implementation Scope

Create a standalone `ContentModule` under `apps/api-nestjs/src/modules/content/`. This keeps CMS page management separate from bookings/users and matches the existing NestJS module boundaries.

### New Files To Add

| File | Purpose |
| --- | --- |
| `apps/api-nestjs/src/modules/content/content.module.ts` | Registers controller, service, and TypeORM repositories. |
| `apps/api-nestjs/src/modules/content/content.controller.ts` | Exposes `GET /content/concept` and `PUT /content/concept`. |
| `apps/api-nestjs/src/modules/content/content.service.ts` | Encapsulates CMS loading, default content, validation, and update persistence. |
| `apps/api-nestjs/src/modules/content/dto/concept-content.dto.ts` | Public read DTO returned by `GET /content/concept`. |
| `apps/api-nestjs/src/modules/content/dto/update-concept-content.dto.ts` | Admin write DTO accepted by `PUT /content/concept`. |
| `apps/api-nestjs/src/modules/content/content.service.spec.ts` | Unit coverage for defaults, read mapping, and update behavior. |
| `apps/api-nestjs/src/modules/content/content.controller.spec.ts` | Unit coverage for public access and admin update delegation. |
| `apps/api-nestjs/src/auth/admin.guard.ts` | Authorizes `UserRole.ADMIN` using `ClerkAuthGuard` output and `UsersService`. |
| `apps/api-nestjs/src/auth/admin.guard.spec.ts` | Unit coverage for allowed admin, forbidden non-admin, and missing user paths. |
| `apps/api-nestjs/src/database/entities/cms-page.entity.ts` | Persists CMS page content keyed by slug, initially `concept`. |
| `apps/api-nestjs/src/database/migrations/<timestamp>-add-cms-pages.ts` | Creates CMS table and seeds initial `concept` content. |

### Existing Files To Modify

| File | Change |
| --- | --- |
| `apps/api-nestjs/src/app.module.ts` | Import `ContentModule`. |
| `apps/api-nestjs/src/auth/auth.module.ts` | Provide and export `AdminGuard` if it lives in `auth/`. |
| `apps/api-nestjs/src/database/database.module.ts` | Register `CmsPage` and the new migration. |
| `apps/api-nestjs/src/database/data-source.ts` | Register the new entity/migration if the CLI data source is explicit. |
| `apps/api-nestjs/src/database/entities/index.ts` | Export `CmsPage` and any content-related enums/types. |
| `apps/api-nestjs/README.md` | Add endpoint and local test notes after implementation. |
| `docs/architecture.md` | Add the content module, CMS entity, and route-level auth model after implementation. |
| `docs/Revisions_followup.md` | Track F19 as a feature release candidate. |
| `docs/evolution/f19-concept-cms-evolution.md` | Record variable/function/file evolution as implementation changes land. |

## Data Model Proposal

Use a generic CMS page table rather than a page-specific table. This keeps the API open for future CMS pages without changing the route contract.

Suggested entity: `CmsPage`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key. |
| `slug` | `varchar` | Unique key. Initial value: `concept`. |
| `title` | `varchar` | Page title. |
| `hero` | `jsonb` | Hero title, subtitle, optional image metadata. |
| `introBlocks` | `jsonb` | Ordered editable text blocks. |
| `howItWorks` | `jsonb` | Ordered steps with title, description, image alt/src. |
| `reassuranceItems` | `jsonb` | Hygiene, professional chef, personalization, and future items. |
| `status` | `varchar` or enum | `draft` or `published` if publishing workflow is required. |
| `updatedByUserId` | `uuid nullable` | Admin user who last changed content. |
| `createdAt` | `timestamptz` | TypeORM create date. |
| `updatedAt` | `timestamptz` | TypeORM update date. |

Store image references as URLs or object keys, not binary payloads. If S3 upload is added later, keep credentials in environment variables and treat S3 as an attached backing service.

## API Contract Draft

### `GET /content/concept`

- Auth: public.
- Returns the published concept content.
- If the `concept` row does not exist, return the seeded default from the migration or a deterministic service default.
- Response status: `200`.

### `PUT /content/concept`

- Auth: Clerk bearer token plus persisted `UserRole.ADMIN`.
- Request body: full replacement of editable concept page fields for deterministic CMS saves.
- Response status: `200`.
- Returns the saved content DTO.
- Non-admin users receive `403`.
- Missing/invalid token receives `401`.

## Open Questions

- Should the CMS support draft/published states in MVP, or should every admin update publish immediately?
- Are images direct remote URLs, S3 object keys, or assets managed by a separate frontend CMS uploader?
- Should content be localized now or deferred until a future feature?
- Should `PUT` be a full replacement only, or should partial updates use `PATCH` later?

## Acceptance Criteria

- `GET /content/concept` is available without authentication.
- Public response includes hero, explanatory text, "Comment ca marche" steps, and reassurance arguments.
- `PUT /content/concept` requires an authenticated admin.
- Admin can update titles, text blocks, step content, and image metadata without deployment.
- Updated content persists in PostgreSQL and is returned by subsequent public GET requests.
- Swagger documents both endpoints and makes admin auth explicit only for the write route.
- Unit tests cover service behavior, controller routing, DTO validation, and admin authorization.
