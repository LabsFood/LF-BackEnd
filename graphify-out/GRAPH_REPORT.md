# Graph Report - LF-BackEnd  (2026-09-08)

## Corpus Check
- 180 files · ~105,426 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1561 nodes · 3518 edges · 90 communities (77 shown, 9 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 175 edges (avg confidence: 0.83)
- Token cost: 209,931 input · 60,506 output

## Community Hubs (Navigation)
- Users Module & DTOs
- Concept CMS Content
- Catalog & Menu Admin
- Fiscal Attestations
- Bookings & Shopping Lists
- Demo Seed Fixtures
- Integration Service Tests
- Third-Party Integration Clients
- Quotes Module
- Package Manifest Metadata
- Auth Guards & Decorators
- Initial Domain Migrations
- Payments Orchestration Services
- CESU Payment Controllers
- Commission Invoice API
- NPM Script Catalogue
- Commission Debit Engine
- TypeScript Compiler Config
- Dev Tooling Dependencies
- Runtime Dependencies
- NestJS Module Wiring
- SEPA Commission Collection Design
- Payment Settlement Helpers
- Stripe Connect & SEPA Mandates
- Database & Deploy Topology
- Raw-Body Webhook Verification
- CESU DTOs & Enums
- SAP Profile & Tax Status
- Prefinanced CESU Design
- Prisma Client & Connections
- Dashboard Stats
- F19 Concept CMS Delivery
- Prisma CLI & Env Loading
- Pagination & User Types
- Profile Update DTOs
- Docker & Local Orchestration
- Clerk-to-DB Sync Script
- User Response DTOs
- Domain Entity Specification
- Production Blockers & Gaps
- Spec & Architecture Docs
- Nest CLI Config
- Clerk ID Normalization
- Commission Debit Constants
- CESU Payments Service
- App Bootstrap & CORS Smoke
- Config Loader & Origins
- Stripe Connect Onboarding API
- Auth & Commission Operations
- Admin Client Query DTOs
- Public Registration Endpoint
- Clerk Sync Contract
- Clerk Webhook Payloads
- Admin User & Role DTOs
- Payments Operating Notes
- Clerk Webhook Handling
- Registration Swagger Responses
- Health & Readiness Probes
- Payments & Webhook Modules
- Migration & Naming Decisions
- Route Tables & Release Register
- Jest Test Configuration
- Clerk JWT Verification
- Chef Profile Upsert DTO
- Stripe Connect Service
- Build TypeScript Config
- Sign-Up & Role Selection
- External Service Map
- Bookings Module Wiring
- Meals & Shopping Spec
- SAP Tax Credit Concepts
- CESU Commission Migration
- Commission Computation
- Chef Verification DTO
- Database Module Wiring
- Railway Deploy Checklist
- SAP & SEPA Foundations Migration
- Env Validation Schema
- Integrations Module
- Lint-Staged Config
- Docker Entrypoint
- Health Module
- Stripe Webhooks Module
- Supabase Database Module
- Single-API Platform Principle
- Chef Profiles Table

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 78 edges
2. `UsersService` - 74 edges
3. `PrismaService` - 54 edges
4. `ClerkUser` - 48 edges
5. `@nestjs/swagger` - 40 edges
6. `CurrentClerkUser` - 40 edges
7. `ApiClerkAuthResponses()` - 39 edges
8. `ApiAdminAuthResponses()` - 39 edges
9. `CommissionDebitsService` - 37 edges
10. `@nestjs/config` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Env precedence trap: .env.local overrides shell exports` --semantically_similar_to--> `api compose service`  [INFERRED] [semantically similar]
  AGENTS.md → docker-compose.yml
- `local-dev/ orchestration files copied to the parent folder` --semantically_similar_to--> `api compose service`  [INFERRED] [semantically similar]
  LOCAL_SETUP.md → docker-compose.yml
- `Uncollectable commission blocks a chef` --semantically_similar_to--> `Clerk webhooks and Postgres sync scripts`  [INFERRED] [semantically similar]
  docs/architecture.md → AGENTS.md
- `50% SAP tax credit (crédit d'impôt)` --semantically_similar_to--> `isPlatformAttestable predicate`  [INFERRED] [semantically similar]
  docs/SPEC-BACKEND.md → AGENTS.md
- `Migrate + boot + health-check smoke test` --conceptually_related_to--> `Auth testing without Clerk (sk_test_placeholder)`  [INFERRED]
  .github/workflows/docker.yml → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CESU payment to commission collection flow** — docs_architecture_prefinanced_cesu, docs_architecture_commission_invoice_facture_b, docs_architecture_sepa_core_clawback_window, docs_architecture_commission_debit_event_routing, docs_architecture_uncollectable_commission_block [EXTRACTED 1.00]
- **Admin- and main-site-only entity set** — docs_spec_admin_dashboard_teammember, docs_spec_admin_dashboard_servicezone, docs_spec_admin_dashboard_kossamorder, docs_spec_admin_dashboard_chefapplication, docs_spec_admin_dashboard_contactmessage, docs_spec_admin_dashboard_review, docs_spec_admin_dashboard_adminsettings [EXTRACTED 1.00]
- **Containerised API boot contract (compose, CI, local stack)** — docker_compose_api_service, docker_compose_postgres_service, _github_workflows_docker_smoke_test, local_setup_docker_everything, docs_architecture_health_readiness_checks [INFERRED 0.85]
- **Clerk sign-up and Postgres sync flow** — docs_auth_clerk_integration_contract_post_auth_register, docs_auth_clerk_integration_contract_sign_in_ticket, docs_auth_clerk_integration_contract_two_step_signup, docs_auth_clerk_integration_contract_get_me_sync, docs_auth_clerk_integration_contract_ensurepersistedfromclerk, docs_auth_clerk_integration_contract_route_selects_role [EXTRACTED 1.00]
- **Card payment via Connect destination charge** — docs_payments_stripe_payments_contract_post_payments_intent, docs_evolution_payments_stripe_cb_evolution_destination_charge, docs_payments_stripe_payments_contract_computecommission, docs_payments_stripe_payments_contract_post_webhooks_stripe, docs_evolution_payments_stripe_cb_evolution_booking_confirm_on_webhook, docs_evolution_payments_stripe_cb_evolution_express_connect_account [EXTRACTED 1.00]
- **CESU settlement and SEPA commission-debit flow** — docs_evolution_payments_stripe_cb_evolution_cesu_prefinanced, docs_evolution_payments_stripe_cb_evolution_chef_confirms_cesu, docs_evolution_payments_stripe_cb_evolution_settlepayment, docs_evolution_payments_stripe_cb_evolution_facture_b, docs_evolution_payments_stripe_cb_evolution_commission_debit_engine, docs_evolution_payments_stripe_cb_evolution_sepa_core_scheme, docs_evolution_payments_stripe_cb_evolution_clawback_window, docs_evolution_payments_stripe_cb_evolution_unpaid_commission_guard [EXTRACTED 1.00]

## Communities (90 total, 9 thin omitted)

### Community 0 - "Users Module & DTOs"
Cohesion: 0.07
Nodes (26): ApiExtraModels, CreateUserDto, ApiProperty, IsEmail, IsOptional, IsString, Length, ApiBearerAuth (+18 more)

### Community 1 - "Concept CMS Content"
Cohesion: 0.07
Nodes (47): CONCEPT_SLUG, ConceptPageContent, DEFAULT_CONCEPT_CONTENT, ContentCmsController, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags (+39 more)

### Community 2 - "Catalog & Menu Admin"
Cohesion: 0.08
Nodes (38): ApiNoContentResponse, CatalogController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+30 more)

### Community 3 - "Fiscal Attestations"
Cohesion: 0.05
Nodes (45): CreatePaymentIntentDto, FiscalAttestationDto, FiscalAttestationProviderDto, ApiProperty, ApiPropertyOptional, IsUUID, FiscalAttestationsController, resolveYear() (+37 more)

### Community 4 - "Bookings & Shopping Lists"
Cohesion: 0.06
Nodes (33): ApiUnprocessableEntityResponse, BookingsController, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+25 more)

### Community 5 - "Demo Seed Fixtures"
Cohesion: 0.10
Nodes (45): BookingPlan, bookingPlans, bookingStatuses, ChefPlan, chefPlans, COMMISSION_RATE_BPS, COMMISSION_VAT_RATE_BPS, CommissionOutcome (+37 more)

### Community 6 - "Integration Service Tests"
Cohesion: 0.12
Nodes (14): serviceWith(), StripeService, Injectable, payload, CONFIRMABLE_INTENT_STATUSES, CONNECT_READY_CHEF, PENDING_BOOKING, AggregatedItem (+6 more)

### Community 7 - "Third-Party Integration Clients"
Cohesion: 0.07
Nodes (14): BrevoService, Injectable, ClerkService, Injectable, CronofyService, Injectable, StreamService, Injectable (+6 more)

### Community 8 - "Quotes Module"
Cohesion: 0.09
Nodes (27): ChefCesuInfo, CreateQuoteDto, ApiProperty, ApiPropertyOptional, IsArray, IsInt, IsOptional, IsString (+19 more)

### Community 9 - "Package Manifest Metadata"
Cohesion: 0.06
Nodes (34): author, description, keywords, license, name, private, version, eslint (+26 more)

### Community 10 - "Auth Guards & Decorators"
Cohesion: 0.22
Nodes (14): AdminGuard, FakeRequest, Injectable, ClerkAuthGuard, ClerkUser, JwtClaims, Injectable, CurrentClerkUser (+6 more)

### Community 11 - "Initial Domain Migrations"
Cohesion: 0.12
Nodes (29): "availability_slots", "bookings", "cms_pages", "provider_profiles", "service_offers", "users", "admin_settings", "application_documents" (+21 more)

### Community 12 - "Payments Orchestration Services"
Cohesion: 0.11
Nodes (9): PaymentIntentDto, idOf(), PaymentsService, Injectable, SepaMandatesService, Injectable, idOf(), StripeWebhooksService (+1 more)

### Community 13 - "CESU Payment Controllers"
Cohesion: 0.18
Nodes (19): ApiForbiddenResponse, CesuPaymentsController, PublicCesuController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+11 more)

### Community 14 - "Commission Invoice API"
Cohesion: 0.11
Nodes (24): CommissionInvoicesController, resolvePeriod(), toCommissionInvoiceDto(), ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+16 more)

### Community 15 - "NPM Script Catalogue"
Cohesion: 0.07
Nodes (27): scripts, build, db:backfill:clerk, db:backfill:clerk:dry, db:generate, db:migrate, db:migrate:dev, db:resolve (+19 more)

### Community 16 - "Commission Debit Engine"
Cohesion: 0.14
Nodes (5): addDays(), CommissionDebitsService, isUniqueViolation(), targetDate(), Injectable

### Community 17 - "TypeScript Compiler Config"
Cohesion: 0.08
Nodes (24): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+16 more)

### Community 18 - "Dev Tooling Dependencies"
Cohesion: 0.08
Nodes (24): devDependencies, eslint, eslint-config-prettier, eslint-plugin-prettier, husky, jest, lint-staged, @nestjs/cli (+16 more)

### Community 19 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, class-transformer, class-validator, @clerk/backend, @fastify/helmet, @fastify/static, ioredis, joi (+15 more)

### Community 20 - "NestJS Module Wiring"
Cohesion: 0.17
Nodes (15): AuthModule, Global, Module, CatalogModule, Module, ClerkWebhooksModule, Module, ContentCmsModule (+7 more)

### Community 21 - "SEPA Commission Collection Design"
Cohesion: 0.11
Nodes (23): 56-day clawback window, SEPA commission-debit engine, Commission invoice (facture B), Service invoice A (prestataire-named), No on_behalf_of on the commission debit, No cron scheduler, on_behalf_of for invoice A seller-of-record, S3 write-only invoice archival (+15 more)

### Community 22 - "Payment Settlement Helpers"
Cohesion: 0.15
Nodes (16): CESU_PAYMENT_INCLUDE, CesuPaymentRow, CESU_SUPPORTED_ISSUERS, CHEF_CESU_INFO_SELECT, ChefCesuInfoRow, toChefCesuInfo(), CommissionStandingBlock, CommissionStandingDb (+8 more)

### Community 23 - "Stripe Connect & SEPA Mandates"
Cohesion: 0.13
Nodes (17): SepaMandateSetupIntentDto, SepaMandateStatusDto, StripeConnectLinkDto, StripeConnectStatusDto, ApiProperty, ApiPropertyOptional, SepaMandatesController, ApiBearerAuth (+9 more)

### Community 24 - "Database & Deploy Topology"
Cohesion: 0.14
Nodes (20): Supabase RLS boundary, Pooler vs direct connection split, apps/prisma.config.ts (Prisma 7), PrismaService runtime connection, SUPABASE_DB_MIGRATION_URL, SUPABASE_DB_URL, Railway deployment of LF-BackEnd, Container entrypoint runs migrate deploy (+12 more)

### Community 25 - "Raw-Body Webhook Verification"
Cohesion: 0.15
Nodes (14): CLERK_WEBHOOK_PATH, getWebhookRawBody(), RawBodyFastifyRequest, registerWebhookRawBodyHook(), STRIPE_WEBHOOK_PATH, WEBHOOK_RAW_BODY_PATHS, buildWebhookHeaders(), HttpCode (+6 more)

### Community 26 - "CESU DTOs & Enums"
Cohesion: 0.21
Nodes (17): BookingPaymentStatusDto, CESU_ISSUERS, CESU_MEDIUMS, ChefCesuInfoDto, DeclareCesuPaymentDto, ForceSettleCesuPaymentDto, RejectCesuPaymentDto, RunDueInvoicesDto (+9 more)

### Community 27 - "SAP Profile & Tax Status"
Cohesion: 0.14
Nodes (15): SAP_DECLARATION_TYPES, SAP_EXTERNAL_STATUSES, SapProfileDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsIn, IsOptional (+7 more)

### Community 28 - "Prefinanced CESU Design"
Cohesion: 0.11
Nodes (19): One fiscal attestation per issuing chef, Booking confirmed only on payment_intent.succeeded, Prefinanced CESU flow (e-CESU first), Chef confirms a CESU payment, Mixed CESU + card coverage, CRCESU NAN publication, No self-declared habilitation, CRCESU no-surcharge rule enforced structurally (+11 more)

### Community 29 - "Prisma Client & Connections"
Cohesion: 0.14
Nodes (11): { prisma, pool }, DEMO_MENU_YEAR, DEMO_SEED_TAG, DEMO_STRIPE_EVENT_PREFIX, createPrismaClient(), PrismaClientBundle, PrismaLogLevel, isSupabaseCloudUrl() (+3 more)

### Community 30 - "Dashboard Stats"
Cohesion: 0.18
Nodes (10): StatsController, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, UseGuards (+2 more)

### Community 31 - "F19 Concept CMS Delivery"
Cohesion: 0.16
Nodes (18): ClerkAuthGuard, RBAC in Postgres only, AdminGuard, CmsPage entity, Deterministic concept defaults, ConceptContentDto, ContentCmsModule (F19), ContentModule (general content) (+10 more)

### Community 32 - "Prisma CLI & Env Loading"
Cohesion: 0.19
Nodes (9): url, toInputJson(), main(), { prisma, pool }, appsDir, args, findRepoRoot(), loadRepoEnv() (+1 more)

### Community 33 - "Pagination & User Types"
Cohesion: 0.15
Nodes (14): buildPaginationMeta(), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageBounds, Paginated, resolvePageBounds(), ClerkJwtHints, ClientProfileWithUser (+6 more)

### Community 34 - "Profile Update DTOs"
Cohesion: 0.18
Nodes (14): UpdateMeChefProfileDto, ApiPropertyOptional, IsArray, IsInt, IsOptional, IsString, Length, Max (+6 more)

### Community 35 - "Docker & Local Orchestration"
Cohesion: 0.14
Nodes (16): build-run-push CI job, No GHCR publish from pull requests, Docker Image CI (manual build), Migrate + boot + health-check smoke test, Services overview (API 8000 / Postgres 5432 / Redis 6379), api compose service, postgres compose service, Redis service commented out (+8 more)

### Community 36 - "Clerk-to-DB Sync Script"
Cohesion: 0.17
Nodes (13): argv, clerkIdArg, confirmed, emailArg, main(), resolveClerkUsers(), roleArg, syncAll (+5 more)

### Community 37 - "User Response DTOs"
Cohesion: 0.29
Nodes (13): PaginationMetaDto, ApiProperty, RegisterResponseDto, ApiProperty, AdminClientDto, ChefProfileDto, ClerkJwtClaimsDto, ClientProfileDto (+5 more)

### Community 38 - "Domain Entity Specification"
Cohesion: 0.15
Nodes (16): Booking aggregate naming (bookings vs reservation), Booking lifecycle state machine, Admin clients pagination contract, ServiceZone entity, Status-to-badge-colour mapping, TeamMember entity, ChatMessage entity, ChatThread entity (+8 more)

### Community 39 - "Production Blockers & Gaps"
Cohesion: 0.15
Nodes (16): Production blockers checklist, CORS_ORIGINS override, Basis-point commission with frozen rates, Stripe Connect destination charge, Express Connect account (FR), Legacy payments rows deleted by backfill, payments 1:N bookings, Admin list pagination breaking change (+8 more)

### Community 40 - "Spec & Architecture Docs"
Cohesion: 0.22
Nodes (15): AGENTS.md — Cursor Cloud instructions, lf-api-nestjs README, Backend Architecture (LF-BackEnd), Target backend module map, ContactMessage entity, KossamOrder entity, KossamOrderItem entity, lib/mock as the backend integration seam (+7 more)

### Community 41 - "Nest CLI Config"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 42 - "Clerk ID Normalization"
Cohesion: 0.26
Nodes (11): assertClerkReachable(), clerk, dryRun, main(), previewClerkUser(), { prisma, pool }, isPlaceholderClerkUserId(), isRealClerkSecretKey() (+3 more)

### Community 43 - "Commission Debit Constants"
Cohesion: 0.15
Nodes (11): CommissionDebitTrigger, CommissionForInvoice, CommissionInvoiceView, DEBITABLE_COMMISSION_STATUSES, LIVE_DEBIT_STATUSES, SEPA_CLAWBACK_WINDOW_DAYS, SEPA_MAX_AMOUNT_CENTS, ACTIVE_MANDATE (+3 more)

### Community 44 - "CESU Payments Service"
Cohesion: 0.31
Nodes (4): CesuPaymentsService, toCesuPaymentDto(), Injectable, CesuPaymentDto

### Community 45 - "App Bootstrap & CORS Smoke"
Cohesion: 0.15
Nodes (11): AppModule, Module, PingController, SmokeModule, Controller, Get, Module, @fastify/helmet (+3 more)

### Community 46 - "Config Loader & Origins"
Cohesion: 0.30
Nodes (10): DEVELOPMENT_ORIGINS, isOriginAllowed(), normalize(), PRODUCTION_ORIGINS, resolveAllowedOrigins(), AppConfig, COMMISSION_DEBIT_TRIGGERS, configLoader() (+2 more)

### Community 47 - "Stripe Connect Onboarding API"
Cohesion: 0.18
Nodes (11): StripeConnectController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, Controller, Get (+3 more)

### Community 48 - "Auth & Commission Operations"
Cohesion: 0.15
Nodes (13): Auth testing without Clerk (sk_test_placeholder), Clerk webhooks and Postgres sync scripts, Env precedence trap: .env.local overrides shell exports, Admin user provisioning routes, AdminGuard (persisted admin role), chef role replaces provider, Clerk as the identity provider, ClerkAuthGuard (+5 more)

### Community 49 - "Admin Client Query DTOs"
Cohesion: 0.18
Nodes (11): PaginationQueryDto, ApiPropertyOptional, IsInt, IsOptional, Max, Min, Type, ListAdminClientsQueryDto (+3 more)

### Community 50 - "Public Registration Endpoint"
Cohesion: 0.23
Nodes (9): RegisterUserDto, ApiProperty, IsEmail, PublicUsersController, ApiTags, Controller, IsStrongPassword, class-validator (+1 more)

### Community 51 - "Clerk Sync Contract"
Cohesion: 0.19
Nodes (13): Admin user provisioning routes, Clerk BAPI email auto-verification gap, ensurePersistedFromClerk, First admin bootstrap, GET /me first sign-in sync, Local Clerk stub mode (sk_test_placeholder), POST /webhooks/clerk, db:backfill:clerk script (+5 more)

### Community 52 - "Clerk Webhook Payloads"
Cohesion: 0.30
Nodes (8): ClerkProfileFields, clerkProfileFromBapiUser(), clerkProfileFromUserJson(), fullNameFromClerkUser(), primaryEmailFromClerkUser(), primaryPhoneFromClerkUser(), mockedVerifyWebhook, @clerk/backend

### Community 53 - "Admin User & Role DTOs"
Cohesion: 0.20
Nodes (11): AppUserRole, CreateAdminUserDto, ApiProperty, ApiPropertyOptional, IsEmail, IsIn, IsOptional, IsString (+3 more)

### Community 54 - "Payments Operating Notes"
Cohesion: 0.22
Nodes (11): Commission facture B collected by SEPA debit, Payments (Stripe) operating notes, Prefinanced CESU operating notes, WEBHOOK_RAW_BODY_PATHS registry, Routing payment_intent events by commission_debits lookup, Commission invoiced as facture B, Prefinanced CESU settlement, Raw-body webhook signature verification (+3 more)

### Community 55 - "Clerk Webhook Handling"
Cohesion: 0.20
Nodes (6): ClerkWebhooksController, ApiExcludeController, ApiTags, Controller, ClerkWebhooksService, Injectable

### Community 56 - "Registration Swagger Responses"
Cohesion: 0.20
Nodes (9): ApiBadRequestResponse, ApiTooManyRequestsResponse, ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiServiceUnavailableResponse, Body, Post (+1 more)

### Community 57 - "Health & Readiness Probes"
Cohesion: 0.27
Nodes (7): HealthController, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, HealthCheck

### Community 58 - "Payments & Webhook Modules"
Cohesion: 0.24
Nodes (6): PaymentsModule, Module, StripeWebhooksController, ApiExcludeController, ApiTags, Controller

### Community 59 - "Migration & Naming Decisions"
Cohesion: 0.22
Nodes (10): Clerk Responsibility Split (frontend vs API), Idempotent migration rule, Prisma baseline for TypeORM databases, Idempotent payments migrations, CESU migration not executed in the working environment, E0 — Prisma adoption, E1 — provider to chef rename, Spec module to NestJS module traceability (+2 more)

### Community 60 - "Route Tables & Release Register"
Cohesion: 0.25
Nodes (9): Feature request issue template, F19 concept CMS module note, F19 Concept CMS routes, Payments route table (apps), Current NestJS module layout, payments module (Connect, CESU, commissions), Release register, vX.Y.Z version scheme (+1 more)

### Community 61 - "Jest Test Configuration"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 62 - "Clerk JWT Verification"
Cohesion: 0.22
Nodes (4): decodeUnverifiedJwt(), shouldVerifyClerkJwt(), FakeRequest, mockedVerifyToken

### Community 63 - "Chef Profile Upsert DTO"
Cohesion: 0.22
Nodes (9): ApiProperty, ApiPropertyOptional, IsInt, IsOptional, IsString, Length, Max, Min (+1 more)

### Community 65 - "Build TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, tsBuildInfoFile, exclude, extends, include, ./tsconfig.json

### Community 66 - "Sign-Up & Role Selection"
Cohesion: 0.32
Nodes (8): Chef vetting flags (is_active / is_verified), POST /auth/register, Profile type switch blocked with 409, Route-selects-the-role rule, Sign-in ticket (signInToken), Two-step sign-up flow, Reversal of the auth/register out-of-scope decision, Auth routes intentionally out of scope

### Community 67 - "External Service Map"
Cohesion: 0.29
Nodes (7): Supabase Storage for CMS assets, Brevo transactional email, Cronofy calendar integration, Google Maps integration, AWS S3 and Supabase Storage, Runtime flow (clients to integrations), Stream messaging integration

### Community 68 - "Bookings Module Wiring"
Cohesion: 0.40
Nodes (4): BookingsModule, Module, ShoppingListsModule, Module

### Community 69 - "Meals & Shopping Spec"
Cohesion: 0.33
Nodes (6): Meal entity, MenuWeek entity, ReservationMeal junction, Shopping list generation by aisle, ShoppingItem entity, ShoppingList entity

### Community 70 - "SAP Tax Credit Concepts"
Cohesion: 0.50
Nodes (5): isPlatformAttestable predicate, Fiscal attestations, AdminSettings singleton, Formule entity (forfait), 50% SAP tax credit (crédit d'impôt)

### Community 71 - "CESU Commission Migration"
Cohesion: 0.40
Nodes (4): "cesu_settlements", "commission_debits", "commission_invoices", "stripe_event_logs"

### Community 72 - "Commission Computation"
Cohesion: 0.60
Nodes (3): CommissionBreakdown, CommissionRates, computeCommission()

### Community 73 - "Chef Verification DTO"
Cohesion: 0.40
Nodes (4): ApiPropertyOptional, IsBoolean, IsOptional, UpdateChefVerificationDto

### Community 74 - "Database Module Wiring"
Cohesion: 0.50
Nodes (3): PrismaModule, Global, Module

### Community 75 - "Railway Deploy Checklist"
Cohesion: 0.50
Nodes (4): Railway production deploy checklist, npm script catalogue (build, db:migrate, db:seed…), Public API endpoint table, Railway public domain vs railway.internal

### Community 76 - "SAP & SEPA Foundations Migration"
Cohesion: 0.50
Nodes (3): "commissions", "sap_profiles", "sepa_mandates"

### Community 78 - "Integrations Module"
Cohesion: 0.67
Nodes (3): IntegrationsModule, Global, Module

## Ambiguous Edges - Review These
- `chef role replaces provider` → `ChefApplication entity`  [AMBIGUOUS]
  docs/SPEC-ADMIN-DASHBOARD.md · relation: conceptually_related_to

## Knowledge Gaps
- **298 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `tsConfigPath` (+293 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 591 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `chef role replaces provider` and `ChefApplication entity`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `@nestjs/common` connect `Integration Service Tests` to `Concept CMS Content`, `Catalog & Menu Admin`, `Fiscal Attestations`, `Third-Party Integration Clients`, `Quotes Module`, `Package Manifest Metadata`, `Auth Guards & Decorators`, `NestJS Module Wiring`, `Payment Settlement Helpers`, `Raw-Body Webhook Verification`, `CESU DTOs & Enums`, `Pagination & User Types`, `User Response DTOs`, `Commission Debit Constants`, `App Bootstrap & CORS Smoke`, `Admin Client Query DTOs`, `Public Registration Endpoint`, `Clerk Webhook Payloads`, `Payments & Webhook Modules`, `Clerk JWT Verification`, `Bookings Module Wiring`, `Database Module Wiring`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `ApiAdminAuthResponses()` connect `Auth Guards & Decorators` to `Users Module & DTOs`, `Concept CMS Content`, `Catalog & Menu Admin`, `Fiscal Attestations`, `Bookings & Shopping Lists`, `User Response DTOs`, `Quotes Module`, `CESU Payment Controllers`, `Commission Invoice API`, `CESU DTOs & Enums`, `Dashboard Stats`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `UsersService` connect `Users Module & DTOs` to `Concept CMS Content`, `Fiscal Attestations`, `Bookings & Shopping Lists`, `Integration Service Tests`, `Third-Party Integration Clients`, `Quotes Module`, `Auth Guards & Decorators`, `Payments Orchestration Services`, `Commission Invoice API`, `NestJS Module Wiring`, `Payment Settlement Helpers`, `SAP Profile & Tax Status`, `Dashboard Stats`, `Pagination & User Types`, `Profile Update DTOs`, `User Response DTOs`, `Admin Client Query DTOs`, `Public Registration Endpoint`, `Clerk Webhook Payloads`, `Clerk Webhook Handling`, `Stripe Connect Service`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Users Module & DTOs` be split into smaller, more focused modules?**
  _Cohesion score 0.0715962441314554 - nodes in this community are weakly interconnected._
- **Should `Concept CMS Content` be split into smaller, more focused modules?**
  _Cohesion score 0.075 - nodes in this community are weakly interconnected._