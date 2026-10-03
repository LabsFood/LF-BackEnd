# Plan: API docs pass and CMS removal

**Requested** 23/09/2026 · **Complexity**: Medium-Large (about 53 routes to document, ~35 files touched)
**Status**: awaiting confirmation — no code written.

## Requirements

1. **Document-type enum in Swagger.** `{type}` on `/me/chef-documents/{type}/…` and
   `/admin/chef-applications/{id}/documents/{type}…`, plus `documentTypes` in the
   request-changes body, list the 10 accepted values instead of a bare string.
2. **Swagger review of every endpoint.** Each route says in plain words what it does,
   who may call it, and shows an example: a request body where there is one, and a
   response. Choices are put in a sensible order and each value is explained.
3. **Remove all CMS code and docs.** Routes `GET`/`PUT /content/concept`, the module, the
   `CmsPage` model and `cms_pages` table, seeds, config and docs. It was a mistake from
   the start of the project.

Constraints: `batchcooking-web` and `labsfood-web` are read-only. The migration is
written, never applied. Nothing is committed or pushed until asked.

## What the research found

- **55 routes, 13 controllers** (53 after the CMS routes go).
- **Five tags are not registered** in `main.ts` (`chef-applications`, `chef-documents`,
  `admin-chef-applications`, `referentials`, `webhooks`). Swagger UI shows them after
  the registered ones, in no particular order. Admin routes sit inside the
  `users`, `catalog`, `bookings`, `quotes` and `stats` sections.
- **Few responses are documented.** Most chef-onboarding routes return plain objects
  with no response schema or example. Some descriptions are out of date: `POST /bookings`
  really returns `501`, and some chef-onboarding routes had no example at all.
- **Nobody uses the CMS.** Neither frontend calls `/content/concept`. On DEV,
  `cms_pages` holds only seed rows: the default `concept` page and 10 `demo-seed-page-*`
  rows. The default copy stays in git history (`concept-defaults.ts`).
- **Nothing generates a client from `openapi.json`** in either frontend, so renaming or
  reordering tags breaks nothing.
- Removing `SUPABASE_CMS_ASSETS_BUCKET` is safe with the variable still set on Railway:
  env validation runs with `allowUnknown: true`.

## Phase 1 — Document-type enum (small)

- Add `DOCUMENT_TYPES` in `chef-onboarding.rules.ts`, derived from `DOCUMENT_LABEL`:
  one source, kebab-case, in family order.
- Use it in `@ApiParam({ name: 'type', enum: DOCUMENT_TYPES })` on the 4 routes that take
  `{type}` and in `RequestChangesDto.documentTypes` (`@ApiProperty({ enum, isArray })`).
- The API behaviour does not change: an unknown value is still `404`.

## Phase 2 — Remove the CMS

| Target | Action |
|---|---|
| `apps/src/modules/content-cms/**` (module, controller, service, DTOs, defaults, 2 specs) | Delete |
| `app.module.ts` import, `content-cms` tag in `main.ts` | Remove |
| `schema.prisma`: `CmsPage` model, `User.cmsPagesUpdated` | Remove |
| New migration `20260923120000_remove_cms_pages` | `DROP TABLE IF EXISTS "cms_pages";` (drops its index and FK with it). Cross-checked against `prisma migrate diff`, **not applied** |
| `prisma/seed.ts` (seeds only the concept page), `seed` in `prisma.config.ts`, `db:seed` script | Delete |
| `seed-demo.ts` / `unseed-demo.ts` CMS pages, `demoCmsSlug` | Remove |
| `src/supabase/types/cms-content.ts`, CMS re-exports in `src/supabase/entities/index.ts` | Delete / remove |
| `SUPABASE_CMS_ASSETS_BUCKET` in `config.loader.ts`, `env.validation.ts`, `supabase.service.ts`, `.env.example` | Remove. Supabase stays: it serves the KYC documents bucket |
| `docs/testing/f19-*` (2), `docs/evolution/f19-concept-cms-evolution.md` | Delete |
| `README.md`, `apps/README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/database-connection.md`, `docs/deploy/railway.md`, `docs/auth/clerk-supabase-sync.md`, `stack.md` | Remove the CMS sections and lines. Replace "CMS assets" with the KYC bucket where Supabase Storage is described |
| `docs/Revisions_followup.md`, `docs/evolution/platform-spec-alignment-evolution.md` | Leave the history, add one line: removed 23/09/2026 |
| Applied migrations `20250522120000_init`, `20250522130000_spec_domain` | **Untouched**: editing an applied migration breaks Prisma's checksum |

## Phase 3 — Swagger pass on every route

**Sections, in this order** (the user's path through the product):

1. `health` — is the API up
2. `auth` — create an account
3. `me` — my account and profile (`GET /me`, `PATCH /me/profile`, `PATCH /me/chef-profile`)
4. `referentials` — reference lists for forms
5. `chef-applications` — become a batch cooker
6. `chef-documents` — batch cooker documents
7. `catalog` — menus, meals, formules
8. `bookings` · 9. `quotes` · 10. `stats`
11. `admin — users`, `admin — batch cookers`, `admin — catalog`, `admin — bookings`,
    `admin — quotes`, `admin — stats` — admin routes get their own sections instead of
    being mixed into the client ones
12. `webhooks` — called by Clerk, not by the frontend

Every tag is registered with a one-line description, so the order is the one above.
In controllers that mix client and admin routes, tags move from the class to each
method, because Swagger merges class and method tags and a route would appear twice.

**Each route gets:**

- `summary`: a short verb phrase ("Submit a candidature").
- `description`: 1 to 3 plain sentences covering what it does, who may call it, and
  what to do next, then an **Example** line where the flow has steps (upload → PUT →
  confirm).
- A response example: a response DTO where one already exists, otherwise
  `@ApiOkResponse({ schema: { example } })` built from the real service output.
- The error codes the route really returns (`409 EMAIL_ALREADY_USED`, `422 VALIDATION_FAILED`, …).
- Request DTO fields each with a description and an `example`.

**Choices, ordered and explained.** Each enum lists its values in a meaningful order,
and the description gives one line per value:

- Lifecycle order for statuses: candidature `submitted → changes-requested → approved/rejected`,
  document `submitted → reviewing → valid/rejected → expiring → expired`, booking and meal statuses as their flow runs.
- Family order for document types: blocking, then conditional, then recommended.
- `client, chef, admin` for roles.

Existing behaviour that looks wrong is **documented as it is, not changed**, and listed
in the summary for you to decide. Examples: `POST /bookings` answers `501`, and the
client booking detail route lives at `/bookings/me/bookings/:id`.

**Structural change:** the Swagger config moves from `main.ts` into
`src/swagger.ts` (`buildOpenApiDocument(app)`). The verification below can then
build the same document without starting the server.

## Validation

```bash
cd apps && export SUPABASE_DB_URL=postgresql://x:y@localhost:5432/x SUPABASE_DB_MIGRATION_URL=postgresql://x:y@localhost:5432/x
npx prisma validate && npx prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script   # equals the migration
npm run build && npx jest && npm run lint
```

- A scratch script (not committed) builds `openapi.json` with `NestFactory.create(AppModule, { preview: true })`,
  which needs no database. It fails if any operation lacks a summary, a description or a
  documented success response, if `{type}` has no enum, or if any `/content` path remains.
- A final grep for `cms`, `Cms`, `concept` and `content-cms` in the backend finds only
  the history lines and the untouched applied migrations.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `DROP TABLE cms_pages` destroys content that exists outside DEV | Low | DEV holds seed rows only. **Check production before applying.** The migration is irreversible, but the default copy stays in git |
| Admin CMS bucket and `SUPABASE_CMS_ASSETS_BUCKET` left behind on Railway/Supabase | Certain, harmless | Listed for you to delete by hand; I do not touch Railway or Supabase |
| Examples drift from real responses | Medium | Examples copied from the service code and tests, not invented |
| A large PR that is hard to review | Medium | Three separate commits (enum, CMS removal, docs pass) |

## Branch — needs your answer

- **Recommended:** the enum (phase 1) on #37, where those routes live. Phases 2 and 3 on a
  new branch `chore/api-docs-and-cms-removal` cut from #37, PR based on #37, retargeted
  to `develop` once #37 merges. This keeps FLOW-01 reviewable and lets the docs
  pass cover the chef-onboarding routes.
- Alternative: everything on #37 — one PR, but about 35 more files unrelated to FLOW-01.

## Found in passing, out of scope

`GET /bookings` returns every booking to any signed-in user; it has no admin guard.
This is on `develop` too. It is filed as a separate task, "Restrict GET /bookings to admins".
