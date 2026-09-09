# Graph Report - LF-BackEnd  (2026-09-09)

## Corpus Check
- 135 files · ~50,672 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1203 nodes · 2298 edges · 66 communities (58 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `afff14d3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- @nestjs/common
- catalog.controller.ts
- ConceptContentDto
- ApiAdminAuthResponses
- CreateBookingDto
- 5.2 Entités
- @nestjs/config
- QuotesService
- 3. Modules & fonctionnalités
- package.json
- 20250522130000_spec_domain/migration.sql
- UsersService
- scripts
- seed-demo.ts
- Epic backlog
- compilerOptions
- devDependencies
- profile.dto.ts
- dependencies
- sync-users-to-clerk.ts
- @nestjs/swagger
- Clerk integration contract (frontend ↔ backend)
- users.controller.ts
- Backend architecture
- main.ts
- sync-clerk-to-db.ts
- Deploy LF-BackEnd on Railway
- clerk-webhooks.controller.ts
- nest-cli.json
- .register
- users.service.ts
- users.controller.spec.ts
- Clerk identity + Supabase/Prisma app data
- LF BackEnd
- Cursor Cloud specific instructions
- ClerkAuthGuard
- create-prisma-client.ts
- env-files.ts
- class-validator
- CreateAdminUserDto
- Clerk admin user management (backend-only)
- Supabase Postgres connection (LF-BackEnd)
- clerk-user-payload.ts
- @clerk/backend
- CreateUserDto
- Cahier De Test - F19 Page "Notre Concept" CMS
- Lancer tout LabsFood en local (les 4 repos)
- jest
- cors-smoke.tmp.spec.ts
- tsconfig.build.json
- Evolution Register - F19 Concept CMS
- Test Execution - F19 Page "Notre Concept" CMS
- Labs Food — Backend stack
- seed.ts
- lf-api-nestjs
- UpdateChefVerificationDto
- ContentCmsController
- Revisions follow-up
- lint-staged
- docker-entrypoint.sh

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 53 edges
2. `UsersService` - 52 edges
3. `PrismaService` - 30 edges
4. `@nestjs/swagger` - 28 edges
5. `ApiAdminAuthResponses()` - 28 edges
6. `scripts` - 27 edges
7. `ClerkUser` - 26 edges
8. `ConceptContentDto` - 24 edges
9. `compilerOptions` - 22 edges
10. `UsersController` - 20 edges

## Surprising Connections (you probably didn't know these)
- `FakeRequest` --references--> `ClerkUser`  [EXTRACTED]
  apps/src/auth/clerk-auth.guard.spec.ts → apps/src/auth/clerk-auth.guard.ts
- `main()` --calls--> `toInputJson()`  [EXTRACTED]
  apps/prisma/seed-demo.ts → apps/prisma/json-helpers.ts
- `main()` --calls--> `toInputJson()`  [EXTRACTED]
  apps/prisma/seed.ts → apps/prisma/json-helpers.ts
- `"client_profiles"` --references--> `"users"`  [EXTRACTED]
  apps/prisma/migrations/20250522130000_spec_domain/migration.sql → apps/prisma/migrations/20250522120000_init/migration.sql
- `"notifications"` --references--> `"users"`  [EXTRACTED]
  apps/prisma/migrations/20250522130000_spec_domain/migration.sql → apps/prisma/migrations/20250522120000_init/migration.sql

## Import Cycles
- None detected.

## Communities (66 total, 2 thin omitted)

### Community 0 - "@nestjs/common"
Cohesion: 0.05
Nodes (42): AuthModule, Global, Module, envValidationSchema, BookingsModule, Module, CatalogModule, Module (+34 more)

### Community 1 - "catalog.controller.ts"
Cohesion: 0.08
Nodes (38): ApiNoContentResponse, CatalogController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+30 more)

### Community 2 - "ConceptContentDto"
Cohesion: 0.09
Nodes (41): CONCEPT_SLUG, ConceptPageContent, DEFAULT_CONCEPT_CONTENT, ApiBearerAuth, ApiOkResponse, ApiOperation, Body, Get (+33 more)

### Community 3 - "ApiAdminAuthResponses"
Cohesion: 0.10
Nodes (30): ApiExtraModels, ApiAdminAuthResponses(), ApiClerkAuthResponses(), StatsController, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags (+22 more)

### Community 4 - "CreateBookingDto"
Cohesion: 0.07
Nodes (31): ApiUnprocessableEntityResponse, BookingsController, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+23 more)

### Community 5 - "5.2 Entités"
Cohesion: 0.05
Nodes (41): 1. Vue d'ensemble, 2.1 Stack recommandée, 2.2 Modules backend, 2.3 Rôles & permissions, 2. Architecture cible, 3.10 Paramètres, 3.1 Authentification, 3.2 Aperçu (dashboard) (+33 more)

### Community 6 - "@nestjs/config"
Cohesion: 0.07
Nodes (16): BrevoService, Injectable, CronofyService, Injectable, IntegrationsModule, Global, Module, StreamService (+8 more)

### Community 7 - "QuotesService"
Cohesion: 0.10
Nodes (26): ApiQuery, CreateQuoteDto, ApiProperty, ApiPropertyOptional, IsArray, IsInt, IsOptional, IsString (+18 more)

### Community 8 - "3. Modules & fonctionnalités"
Cohesion: 0.06
Nodes (36): 1. Vue d'ensemble, 2.1 Arborescence du projet, 2.2 Couches, 2.3 Authentification & rôles, 2. Architecture, 3.10 Candidatures chef (`/candidatures`, `/candidatures/[id]`), 3.11 Messages de contact (`/contact`), 3.12 Avis & témoignages (`/avis`) (+28 more)

### Community 9 - "package.json"
Cohesion: 0.06
Nodes (33): author, description, keywords, license, name, private, version, eslint (+25 more)

### Community 10 - "20250522130000_spec_domain/migration.sql"
Cohesion: 0.12
Nodes (29): "availability_slots", "bookings", "cms_pages", "provider_profiles", "service_offers", "users", "admin_settings", "application_documents" (+21 more)

### Community 11 - "UsersService"
Cohesion: 0.12
Nodes (4): UpdateMeChefProfileDto, UpdateMeProfileDto, Injectable, UsersService

### Community 12 - "scripts"
Cohesion: 0.07
Nodes (27): scripts, build, db:backfill:clerk, db:backfill:clerk:dry, db:generate, db:migrate, db:migrate:dev, db:resolve (+19 more)

### Community 13 - "seed-demo.ts"
Cohesion: 0.19
Nodes (21): bookingStatuses, main(), { prisma, pool }, profileStatuses, quoteStatuses, main(), { prisma, pool }, DEMO_COUNT (+13 more)

### Community 14 - "Epic backlog"
Cohesion: 0.08
Nodes (26): Admin API checklist (all Todo), Change log, Client API checklist (Todo except noted), Documentation alignment (this effort), E0 — Prisma adoption, E10 — Stats (`stats`), E11 — Main site / admin-only domains, E12 — Infrastructure (+18 more)

### Community 15 - "compilerOptions"
Cohesion: 0.08
Nodes (24): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+16 more)

### Community 16 - "devDependencies"
Cohesion: 0.08
Nodes (24): devDependencies, eslint, eslint-config-prettier, eslint-plugin-prettier, husky, jest, lint-staged, @nestjs/cli (+16 more)

### Community 17 - "profile.dto.ts"
Cohesion: 0.11
Nodes (21): ApiProperty, ApiPropertyOptional, IsInt, IsOptional, IsString, Length, Max, Min (+13 more)

### Community 18 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, class-transformer, class-validator, @clerk/backend, @fastify/helmet, @fastify/static, ioredis, joi (+15 more)

### Community 19 - "sync-users-to-clerk.ts"
Cohesion: 0.15
Nodes (13): assertClerkReachable(), clerk, dryRun, main(), previewClerkUser(), { prisma, pool }, isPlaceholderClerkUserId(), isRealClerkSecretKey() (+5 more)

### Community 20 - "@nestjs/swagger"
Cohesion: 0.24
Nodes (9): AdminGuard, FakeRequest, Injectable, ClerkUser, JwtClaims, CurrentClerkUser, ContentCmsService, Injectable (+1 more)

### Community 21 - "Clerk integration contract (frontend ↔ backend)"
Cohesion: 0.09
Nodes (23): A. Sign-up → DB sync (simulates frontend), Admin user provisioning, B. Sign-in → protected API, BAPI email verification note, C. Bootstrap first admin, Chef vetting, Clerk integration contract (frontend ↔ backend), Code map (+15 more)

### Community 22 - "users.controller.ts"
Cohesion: 0.23
Nodes (16): DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageBounds, PaginationMetaDto, ApiProperty, RegisterResponseDto, ApiProperty, AdminClientDto (+8 more)

### Community 23 - "Backend architecture"
Cohesion: 0.11
Nodes (18): Admin backlog (SPEC-ADMIN-DASHBOARD), API surface summary, Authentication, Backend architecture, Booking lifecycle (target), Client / public backlog (SPEC-BACKEND), Current module layout (implemented), Data model direction (+10 more)

### Community 24 - "main.ts"
Cohesion: 0.24
Nodes (12): AppModule, Module, DEVELOPMENT_ORIGINS, isOriginAllowed(), normalize(), PRODUCTION_ORIGINS, resolveAllowedOrigins(), AppConfig (+4 more)

### Community 25 - "sync-clerk-to-db.ts"
Cohesion: 0.17
Nodes (13): argv, clerkIdArg, confirmed, emailArg, main(), resolveClerkUsers(), roleArg, syncAll (+5 more)

### Community 26 - "Deploy LF-BackEnd on Railway"
Cohesion: 0.12
Nodes (16): 1. Create the service, 2. Environment variables, 3. Database URLs (Supabase), 4. Public domain & API URLs, 5. Deploy flow, 6. Local Docker vs Railway, Blockers checklist (you must supply), CORS (+8 more)

### Community 27 - "clerk-webhooks.controller.ts"
Cohesion: 0.18
Nodes (11): ApiExcludeController, CLERK_WEBHOOK_PATH, getClerkWebhookRawBody(), RawBodyFastifyRequest, buildWebhookHeaders(), ClerkWebhooksController, ApiTags, Controller (+3 more)

### Community 28 - "nest-cli.json"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 29 - ".register"
Cohesion: 0.14
Nodes (12): ApiBadRequestResponse, ApiTooManyRequestsResponse, PublicUsersController, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags (+4 more)

### Community 30 - "users.service.ts"
Cohesion: 0.16
Nodes (12): buildPaginationMeta(), Paginated, resolvePageBounds(), AppUserRole, ClerkJwtHints, ClientProfileWithUser, CreateWithRoleInput, OwnUserFields (+4 more)

### Community 31 - "users.controller.spec.ts"
Cohesion: 0.16
Nodes (12): PaginationQueryDto, ApiPropertyOptional, IsInt, IsOptional, Max, Min, Type, ListAdminClientsQueryDto (+4 more)

### Community 32 - "Clerk identity + Supabase/Prisma app data"
Cohesion: 0.14
Nodes (14): 1. Clerk → Postgres (primary, ongoing), 2. Postgres → Clerk (migration / demo, one-off), 3. Request-time upsert (first sign-in), Admin provisioning (Backend API), Backfill for accounts the webhook never saw, Clerk identity + Supabase/Prisma app data, Code map, Dashboard / frontend contract (+6 more)

### Community 33 - "LF BackEnd"
Cohesion: 0.14
Nodes (14): 1. Configure environment, 2. Run with Docker Compose (local), 3. Production on Railway, 4. Run locally (without Docker API image), API endpoints, Documentation, Frontends (outside this repo), Getting started (+6 more)

### Community 35 - "Cursor Cloud specific instructions"
Cohesion: 0.17
Nodes (11): Application specifiactions, Auth testing without Clerk, Clerk webhooks and DB sync, Cursor Cloud specific instructions, Database (Prisma), F19 concept CMS, Linting and testing, Railway production (+3 more)

### Community 36 - "ClerkAuthGuard"
Cohesion: 0.20
Nodes (6): ClerkAuthGuard, decodeUnverifiedJwt(), shouldVerifyClerkJwt(), FakeRequest, mockedVerifyToken, Injectable

### Community 37 - "create-prisma-client.ts"
Cohesion: 0.21
Nodes (7): createPrismaClient(), PrismaClientBundle, PrismaLogLevel, isSupabaseCloudUrl(), postgresSsl(), pg, @prisma/adapter-pg

### Community 38 - "env-files.ts"
Cohesion: 0.31
Nodes (6): url, appsDir, args, findRepoRoot(), loadRepoEnv(), resolveEnvFilePaths()

### Community 39 - "class-validator"
Cohesion: 0.29
Nodes (7): RegisterUserDto, ApiProperty, IsEmail, IsStrongPassword, class-transformer, class-validator, @nestjs/throttler

### Community 40 - "CreateAdminUserDto"
Cohesion: 0.22
Nodes (10): CreateAdminUserDto, ApiProperty, ApiPropertyOptional, IsEmail, IsOptional, IsString, MinLength, UpdateUserRoleDto (+2 more)

### Community 41 - "Clerk admin user management (backend-only)"
Cohesion: 0.18
Nodes (10): Admin endpoints, Architecture boundary, Clerk admin user management (backend-only), ClerkService, Documentation, First admin bootstrap, Frontend contract (Next.js), Out of scope (explicit) (+2 more)

### Community 42 - "Supabase Postgres connection (LF-BackEnd)"
Cohesion: 0.18
Nodes (11): Behavior in this repo, Env file location, Environment variables, Prisma baseline (existing TypeORM databases), Prisma commands (ORM 7), Railway production, Supabase Postgres connection (LF-BackEnd), URI formats (placeholders) (+3 more)

### Community 43 - "clerk-user-payload.ts"
Cohesion: 0.40
Nodes (6): ClerkProfileFields, clerkProfileFromBapiUser(), clerkProfileFromUserJson(), fullNameFromClerkUser(), primaryEmailFromClerkUser(), primaryPhoneFromClerkUser()

### Community 44 - "@clerk/backend"
Cohesion: 0.27
Nodes (4): ClerkWebhooksService, mockedVerifyWebhook, Injectable, @clerk/backend

### Community 45 - "CreateUserDto"
Cohesion: 0.24
Nodes (6): CreateUserDto, ApiProperty, IsEmail, IsOptional, IsString, Length

### Community 46 - "Cahier De Test - F19 Page "Notre Concept" CMS"
Cohesion: 0.20
Nodes (9): API Payload Example, Cahier De Test - F19 Page "Notre Concept" CMS, Exit Criteria, Functional Test Cases, Non-Regression Test Cases, Objective, Required Test Data, Scope (+1 more)

### Community 47 - "Lancer tout LabsFood en local (les 4 repos)"
Cohesion: 0.20
Nodes (9): 1. Prerequis (une seule fois sur la machine), 2. Cloner les 4 repos cote a cote, 3. Copier les fichiers d'orchestration a la racine, 4. Lancer toute la stack, 5. Verifier que tout tourne, 6. Depannage, Alternative sans Docker, Ce guide vous manque quelque chose ? (+1 more)

### Community 48 - "jest"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 49 - "cors-smoke.tmp.spec.ts"
Cohesion: 0.22
Nodes (7): PingController, SmokeModule, Controller, Get, Module, @nestjs/core, @nestjs/platform-fastify

### Community 50 - "tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, tsBuildInfoFile, exclude, extends, include, ./tsconfig.json

### Community 51 - "Evolution Register - F19 Concept CMS"
Cohesion: 0.25
Nodes (8): Change Log, Documentation Evolution, Evolution Register - F19 Concept CMS, File Evolution, Function And Class Evolution, Purpose, Route Evolution, Variable And DTO Evolution

### Community 52 - "Test Execution - F19 Page "Notre Concept" CMS"
Cohesion: 0.25
Nodes (7): Baseline Verification Commands, Current Implementation Qualification, Execution Records, Execution Summary, Functional Test Status, Qualification Notes, Test Execution - F19 Page "Notre Concept" CMS

### Community 53 - "Labs Food — Backend stack"
Cohesion: 0.29
Nodes (7): Application, Authentication & roles, Domain naming (resolved), Integrations, Labs Food — Backend stack, Related documentation, Runtime flow

### Community 54 - "seed.ts"
Cohesion: 0.47
Nodes (3): toInputJson(), main(), { prisma, pool }

### Community 55 - "lf-api-nestjs"
Cohesion: 0.33
Nodes (6): Admin users (`/admin/users`), F19 — Concept CMS (`/content/concept`), lf-api-nestjs, Local development, Run with Docker Compose, Scripts

### Community 56 - "UpdateChefVerificationDto"
Cohesion: 0.40
Nodes (4): ApiPropertyOptional, IsBoolean, IsOptional, UpdateChefVerificationDto

### Community 57 - "ContentCmsController"
Cohesion: 0.50
Nodes (3): ContentCmsController, ApiTags, Controller

### Community 58 - "Revisions follow-up"
Cohesion: 0.50
Nodes (3): Release register, Revisions follow-up, Version scheme: `vX.Y.Z`

## Knowledge Gaps
- **424 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `tsConfigPath` (+419 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 624 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@nestjs/common` connect `@nestjs/common` to `catalog.controller.ts`, `ConceptContentDto`, `ClerkAuthGuard`, `@nestjs/config`, `class-validator`, `package.json`, `@clerk/backend`, `cors-smoke.tmp.spec.ts`, `sync-users-to-clerk.ts`, `@nestjs/swagger`, `users.controller.ts`, `main.ts`, `clerk-webhooks.controller.ts`, `users.service.ts`, `users.controller.spec.ts`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Why does `ApiAdminAuthResponses()` connect `ApiAdminAuthResponses` to `catalog.controller.ts`, `ConceptContentDto`, `CreateBookingDto`, `QuotesService`, `@nestjs/swagger`, `users.controller.ts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `@nestjs/swagger` connect `@nestjs/swagger` to `@nestjs/common`, `catalog.controller.ts`, `ConceptContentDto`, `class-validator`, `QuotesService`, `package.json`, `CreateAdminUserDto`, `CreateUserDto`, `profile.dto.ts`, `users.controller.ts`, `main.ts`, `UpdateChefVerificationDto`, `clerk-webhooks.controller.ts`, `users.controller.spec.ts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _424 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `@nestjs/common` be split into smaller, more focused modules?**
  _Cohesion score 0.05331510594668489 - nodes in this community are weakly interconnected._
- **Should `catalog.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07773664727657324 - nodes in this community are weakly interconnected._
- **Should `ConceptContentDto` be split into smaller, more focused modules?**
  _Cohesion score 0.08821548821548822 - nodes in this community are weakly interconnected._