# Graph Report - LF-BackEnd  (2026-10-12)

## Corpus Check
- 308 files · ~187,209 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2942 nodes · 8285 edges · 132 communities (119 shown, 10 thin omitted)
- Extraction: 92% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 619 edges (avg confidence: 0.83)
- Token cost: 577,799 input · 0 output

## Community Hubs (Navigation)
- Clerk & Users Service
- Contact Forms
- Quotes
- Auth Guards
- Pagination & Booking DTOs
- Chef Application Submission
- Admin Chefs Back Office
- Audit Log
- Chef Me-Content API
- Admin Moderation
- Vitrine Rules
- Chef Content Service
- Initial DB Migrations
- Content Photos & Suggestions
- Dishes Swagger Examples
- Catalog Admin DTO Validation
- Messaging Gateway & Redis
- Backend Architecture Docs
- Users Controller Swagger
- Package Metadata
- Dishes Test Helpers
- Catalog Controller
- Admin Content Controller
- Messaging DTOs & Examples
- Catalog Service & Ownership
- Pagination & Moderation Rules
- Messaging Service Core
- R2 Storage & Avatars
- Me Conversations API
- Admin Conversations API
- Payment & Fiscal DTOs
- Chef Onboarding Mailer & Cron
- Admin Chef Applications API
- Stripe Payments Contract Docs
- Brevo Email Templates
- Runtime Dependencies
- Chef Onboarding Rules
- Supabase & KYC Documents
- Chef Dishes Menus PRD
- Messaging Rules & Contact Release
- Demo Seed Data
- CORS & Webhook Raw Body
- Messaging View Types
- Docker Compose Stack
- NPM Scripts
- Missions Controller
- Bookings Spec Docs
- Brevo & Cronofy Integrations
- Bookings Controller
- Dev Dependencies
- App & Auth Modules
- TypeScript Config
- Clerk Integration Docs
- Chef Documents Controller
- Dishes & Menus Rules
- Pagination Query DTO
- Chef Applications Service
- Messaging Admin Service
- Catalog Meal DTOs
- Chef Onboarding Swagger Examples
- Dish & Recipe DTOs
- Avatar Controller
- Public User Registration
- Admin Dashboard Spec
- Stripe Service
- Clerk Webhooks
- Dual-Role Switcher Analysis
- Stripe Connect
- SEPA Mandates
- Chef Applications Admin Service
- Shopping Lists Service
- API Docs & CMS Removal Plan
- Labs Food Content
- Missions Service (FLOW-02)
- Agent & Dev Guidelines
- Clerk-to-DB Sync Script
- Users-to-Clerk Sync Script
- Recipe Rules
- Mission DTOs
- Nest CLI Config
- Fastify Raw Body
- KYC Storage & Dossier Cron
- Admin Content Photos
- Chef Onboarding PRD
- Contact Detection & Masking
- Prisma Env Config
- Payment Intents
- Profile DTOs
- Prisma Client & DB Connection
- Booking & Meal Ownership Gaps
- Create Booking DTO
- Payments Webhook Handlers
- Dish Ownership Plan
- Brevo Templates PRD
- Clerk User Payload
- Referentials Controller
- Health Controller
- Payments Module & Stripe Webhooks
- SAP Profile DTO
- Jest Config
- Chef Profile DTO
- Chef Onboarding Migration
- Messaging Storage
- TS Build Config
- Countries Referential
- Stripe Connect DTOs
- Docker CI Workflow
- Bookings & Shopping Modules
- Booking Read DTO
- Messaging Notifier Cron
- Payments Controller
- CMS Removal & KYC Notes
- Commission Calculation
- Payments SAP SEPA Migration
- CORS Smoke Test
- Env Validation
- Gateway Auth Handler
- Redis Module
- Audit Module
- Integrations Module
- App Module
- Health Module
- Database Module
- Husky Pre-commit
- Feature Request Template
- Chef Profiles Table
- Chef Profiles Table
- Chef Profiles Table
- Chef Applications Table

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 132 edges
2. `ClerkUser` - 130 edges
3. `CurrentClerkUser` - 119 edges
4. `UsersService` - 95 edges
5. `PrismaService` - 95 edges
6. `ApiClerkAuthResponses()` - 91 edges
7. `ApiAdminAuthResponses()` - 86 edges
8. `@nestjs/swagger` - 62 edges
9. `AuditService` - 39 edges
10. `MessagingService` - 37 edges

## Surprising Connections (you probably didn't know these)
- `Swagger pass on every route (summary, description, examples, error codes)` --references--> `TAGS`  [INFERRED]
  .claude/plans/api-docs-and-cms-removal.plan.md → apps/src/common/swagger/tags.ts
- `Daily in-process scheduled job for expiry, suspension and retention` --references--> `ChefDossierCron`  [INFERRED]
  .claude/prds/batchcooker-chef-onboarding.prd.md → apps/src/modules/chef-onboarding/services/chef-dossier.cron.ts
- `Retention purge on the FLOW-01 section 8 schedule` --references--> `ChefDossierCron`  [INFERRED]
  .claude/prds/batchcooker-chef-onboarding.prd.md → apps/src/modules/chef-onboarding/services/chef-dossier.cron.ts
- `RBAC from Postgres users.role only` --references--> `AdminGuard`  [INFERRED]
  docs/auth/clerk-integration-contract.md → apps/src/auth/admin.guard.ts
- `client / chef / admin roles` --references--> `AdminGuard`  [EXTRACTED]
  stack.md → apps/src/auth/admin.guard.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **FLOW-01 public account creation safeguards** — _claude_plans_handoff_public_account_creation_security_requirements, _claude_plans_rework_37_account_at_submission_sign_in_link_inbox_only, _claude_plans_rework_37_account_at_submission_clerk_compensating_delete, _claude_plans_rework_37_account_at_submission_verification_bypass, _claude_plans_dual_role_switcher_analysis_existing_account_takeover_risk [INFERRED 0.85]
- **FLOW-02 content ownership model (owner, suggestions, offers, adoption, isolation)** — _claude_prds_chef_dishes_menus_prd_ownership_authorship_split, _claude_prds_chef_dishes_menus_prd_suggestions, _claude_prds_chef_dishes_menus_prd_offers, _claude_prds_chef_dishes_menus_prd_adoption, _claude_prds_chef_dishes_menus_prd_chef_isolation, _claude_plans_chef_dishes_menus_architecture_derived_row_kinds, _claude_plans_chef_dishes_menus_architecture_one_access_rule [INFERRED 0.85]
- **Brevo template safety and editing workflow** — _claude_prds_brevo_templates_prd_html_template_sources, _claude_prds_brevo_templates_prd_security_rules, _claude_prds_brevo_templates_prd_upload_check_update, _claude_prds_brevo_templates_prd_upload_digest [EXTRACTED 1.00]
- **Chef application lifecycle emails** — brevo_templates_brevo_tpl_application_received, brevo_templates_brevo_tpl_application_received_admin, brevo_templates_brevo_tpl_changes_requested, brevo_templates_brevo_tpl_document_rejected, brevo_templates_brevo_tpl_application_approved, brevo_templates_brevo_tpl_application_rejected, brevo_templates_brevo_tpl_sign_in_link, apps_src_modules_chef_onboarding_services_chef_onboarding_mailer_chefonboardingmailer [INFERRED 0.85]
- **KYC document expiry and suspension flow** — brevo_templates_brevo_tpl_document_expiring, brevo_templates_brevo_tpl_chef_suspended, brevo_templates_brevo_tpl_document_rejected, stack_supabase_storage [INFERRED 0.75]
- **Brevo template sync pipeline** — brevo_readme, brevo_layout, brevo_templates, brevo_upload, brevo_templates_test, brevo_upload_test, brevo_readme_upload_drift_detection [EXTRACTED 1.00]
- **Card payment flow (Stripe Connect destination charge)** — docs_payments_stripe_payments_contract_payment_intent_endpoint, docs_payments_stripe_payments_contract_destination_charge, docs_payments_stripe_payments_contract_commission_arithmetic, docs_payments_stripe_payments_contract_stripe_webhook, docs_payments_stripe_payments_contract_stripe_connect_onboarding, docs_architecture_booking_lifecycle_impl [EXTRACTED 1.00]
- **Clerk <-> Postgres user sync mechanisms** — docs_auth_clerk_integration_contract_get_me_sync, docs_auth_clerk_supabase_sync_clerk_webhooks, docs_auth_clerk_supabase_sync_backfill_script, docs_auth_clerk_supabase_sync_sync_to_clerk, docs_auth_clerk_integration_contract_admin_provisioning, docs_auth_clerk_supabase_sync_postgres_source_of_truth [EXTRACTED 1.00]
- **Idempotent replay-safety pattern (migrations, webhooks, intents, cron)** — docs_database_connection_idempotent_migrations, docs_evolution_payments_stripe_cb_evolution_payments_migration, docs_payments_stripe_payments_contract_webhook_idempotency, docs_payments_stripe_payments_contract_intent_idempotency, docs_deploy_railway_chef_dossier_cron [INFERRED 0.85]

## Communities (132 total, 10 thin omitted)

### Community 0 - "Clerk & Users Service"
Cohesion: 0.05
Nodes (37): ClerkService, Injectable, mockedVerifyWebhook, FORM, STORED, Role, FUTURE, PINNED (+29 more)

### Community 1 - "Contact Forms"
Cohesion: 0.05
Nodes (49): Contact forms: stored first, emailed second, AdminContactController, ApiMessageIdParam(), ContactController, reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse (+41 more)

### Community 2 - "Quotes"
Cohesion: 0.05
Nodes (40): CreateQuoteDto, ApiProperty, ApiPropertyOptional, IsArray, IsInt, IsOptional, IsString, IsUUID (+32 more)

### Community 3 - "Auth Guards"
Cohesion: 0.08
Nodes (35): AdminGuard, Injectable, assertClerkConfigured(), ClerkAuthGuard, decodeUnverifiedJwt(), JwtClaims, resolveClaims(), resolveClerkUser() (+27 more)

### Community 4 - "Pagination & Booking DTOs"
Cohesion: 0.07
Nodes (43): DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PaginationMetaDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsOptional, UpdateChefVerificationDto (+35 more)

### Community 5 - "Chef Application Submission"
Cohesion: 0.07
Nodes (50): ChefApplicationsController, MyChefApplicationController, reqId(), ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse (+42 more)

### Community 6 - "Admin Chefs Back Office"
Cohesion: 0.05
Nodes (43): Batch cookers in the back office (LF-0164, GET /admin/chefs), AdminChefsController, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+35 more)

### Community 7 - "Audit Log"
Cohesion: 0.08
Nodes (26): AuditActorType, AuditEntry, AuditService, Injectable, ChefOnboardingEmail, ChefOnboardingModule, Module, DOCUMENT_FAMILY (+18 more)

### Community 8 - "Chef Me-Content API"
Cohesion: 0.21
Nodes (27): CurrentClerkUser, ApiClerkAuthResponses(), ApiDishIdParam(), ApiMenuIdParam(), MeContentController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse (+19 more)

### Community 9 - "Admin Moderation"
Cohesion: 0.09
Nodes (33): AdminModerationController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+25 more)

### Community 10 - "Vitrine Rules"
Cohesion: 0.07
Nodes (42): coveredDiets(), coversArea(), InterventionZone, parisClock, parisMidnight(), rotationKey(), vitrineOrder(), ChefShowcaseQueryDto (+34 more)

### Community 11 - "Chef Content Service"
Cohesion: 0.10
Nodes (17): ChefContentService, Injectable, ContentPhotosService, service(), Injectable, assertPublishable(), changedMeanwhile(), DishesService (+9 more)

### Community 12 - "Initial DB Migrations"
Cohesion: 0.08
Nodes (43): "availability_slots", "bookings", "cms_pages", "provider_profiles", "service_offers", "users", "admin_settings", "application_documents" (+35 more)

### Community 13 - "Content Photos & Suggestions"
Cohesion: 0.10
Nodes (31): ChefContext, MENU_DISHES, MenuWithDishes, chefPhotoFolder(), PhotoKind, plural(), toDishView(), toModeration() (+23 more)

### Community 14 - "Dishes Swagger Examples"
Cohesion: 0.07
Nodes (38): MAX_PHOTO_BYTES, PHOTO_TYPES, LABS_FOOD_MENU_EXAMPLE, NOT_LABS_FOOD, ADMIN_DISH, CHEF, QUEUE_EXAMPLE, REASON_REQUIRED (+30 more)

### Community 15 - "Catalog Admin DTO Validation"
Cohesion: 0.07
Nodes (33): CONTINENTS, DIFFICULTIES, MEAL_STATUSES, ALLERGEN_CODES, DIET_CODES, DISH_CATEGORY_CODES, DIFFICULTIES, FREE_TEXT (+25 more)

### Community 16 - "Messaging Gateway & Redis"
Cohesion: 0.08
Nodes (15): MessagingGateway, SocketState, RealtimeEnvelope, RealtimeEvent, Listener, MessagingEventsService, Injectable, MessagingRateLimiter (+7 more)

### Community 17 - "Backend Architecture Docs"
Cohesion: 0.09
Nodes (42): Backend architecture (LF-BackEnd), Brevo email integration, chef role replaces provider, Cloudflare R2 public dish photos (R2StorageService), Cronofy calendar integration, Health checks GET /health and GET /ready, In-house messaging (modules/messaging, Stream dropped), Implemented module layout (apps/src/modules) (+34 more)

### Community 18 - "Users Controller Swagger"
Cohesion: 0.15
Nodes (20): ApiExtraModels, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+12 more)

### Community 19 - "Package Metadata"
Cohesion: 0.05
Nodes (37): author, description, keywords, license, lint-staged, {src,test}/**/*.ts, name, private (+29 more)

### Community 20 - "Dishes Test Helpers"
Cohesion: 0.13
Nodes (19): CHEF, codeOf(), dishRow(), harness(), menuRow(), UNMODERATED, WriteArgs, service() (+11 more)

### Community 21 - "Catalog Controller"
Cohesion: 0.14
Nodes (23): ApiMealIdParam(), CatalogController, loggable(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse (+15 more)

### Community 22 - "Admin Content Controller"
Cohesion: 0.23
Nodes (22): AdminContentController, ApiMenuIdParam(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse (+14 more)

### Community 23 - "Messaging DTOs & Examples"
Cohesion: 0.10
Nodes (34): AdminListConversationsQueryDto, AttachmentRefDto, CreateAttachmentUploadDto, ListMessagesQueryDto, OpenConversationDto, OpenSupportConversationDto, SendMessageDto, ApiProperty (+26 more)

### Community 24 - "Catalog Service & Ownership"
Cohesion: 0.11
Nodes (23): Owner-filtered write: where {id, chefProfileId: null}, CatalogService, declarationOf(), isNotFound(), LABS_FOOD, safetyChanged(), LABS_FOOD_MEAL_1, touchesDeclaration() (+15 more)

### Community 25 - "Pagination & Moderation Rules"
Cohesion: 0.11
Nodes (24): buildPaginationMeta(), PageBounds, Paginated, resolvePageBounds(), RECIPE_FIELDS, Loaded, SOURCE_LABEL, WITH_REPLIES (+16 more)

### Community 26 - "Messaging Service Core"
Cohesion: 0.14
Nodes (9): PairBooking, ConversationDetailView, ConversationView, MessageView, isUniqueViolation(), MessagingService, toMessageView(), Injectable (+1 more)

### Community 27 - "R2 Storage & Avatars"
Cohesion: 0.11
Nodes (12): detectImageType(), photoKey(), R2Config, R2StorageService, CONFIG, configured(), Injectable, storage() (+4 more)

### Community 28 - "Me Conversations API"
Cohesion: 0.17
Nodes (23): FakeRequest, ClerkUser, ApiConversationIdParam(), MeConversationsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNoContentResponse (+15 more)

### Community 29 - "Admin Conversations API"
Cohesion: 0.19
Nodes (22): ApiAdminAuthResponses(), AdminConversationsController, ApiConversationIdParam(), reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse (+14 more)

### Community 30 - "Payment & Fiscal DTOs"
Cohesion: 0.12
Nodes (22): CreatePaymentIntentDto, FiscalAttestationDto, FiscalAttestationProviderDto, ApiProperty, ApiPropertyOptional, IsUUID, FiscalAttestationsController, resolveYear() (+14 more)

### Community 31 - "Chef Onboarding Mailer & Cron"
Cohesion: 0.13
Nodes (18): expiryNoticeThreshold(), Brevo shared email layout, params: line contract, signInUrl invariant, Application approved email (BREVO_TPL_APPLICATION_APPROVED), Application received email (BREVO_TPL_APPLICATION_RECEIVED), Application received admin email (BREVO_TPL_APPLICATION_RECEIVED_ADMIN), Application rejected email (BREVO_TPL_APPLICATION_REJECTED) (+10 more)

### Community 32 - "Admin Chef Applications API"
Cohesion: 0.20
Nodes (21): ApiApplicationIdParam(), ChefApplicationsAdminController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse (+13 more)

### Community 33 - "Stripe Payments Contract Docs"
Cohesion: 0.14
Nodes (30): chef_profiles table, Chef vetting (is_active / is_verified), ChefDossierCron daily job (expiry warnings, suspension, purge), Evolution register - Payments (Stripe CB, Connect, SAP/SEPA), Payments known follow-ups (refunds, PDF, CESU, admin lists), payment_method enum (cb, avance_immediate, cesu), payment_status enum (paid reserved, unused), Migration 20260831120000_payments_sap_sepa_foundations (+22 more)

### Community 34 - "Brevo Email Templates"
Cohesion: 0.09
Nodes (19): One .html per BREVO_TPL_* plus layout.html, loaded by templates.mjs, Brevo email templates README, Brevo template security rules, Upload digest drift detection, dir, layout, templates, declared() (+11 more)

### Community 35 - "Runtime Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, class-transformer, class-validator, @clerk/backend, @fastify/helmet, @fastify/static (+21 more)

### Community 36 - "Chef Onboarding Rules"
Cohesion: 0.12
Nodes (22): ApplicationAnswers, AWAITING_DECISION, COUNTS_AS_VALID, deriveDossierStatus(), DocumentFamily, DocumentRequirement, DossierDocument, DossierStatus (+14 more)

### Community 37 - "Supabase & KYC Documents"
Cohesion: 0.11
Nodes (20): Document-type enum in Swagger (DOCUMENT_TYPES derived from DOCUMENT_LABEL), SupabaseService, Injectable, DOCUMENT_TYPES, ConfirmUploadDto, CreateUploadUrlDto, DecideDocumentDto, ApiProperty (+12 more)

### Community 38 - "Chef Dishes Menus PRD"
Cohesion: 0.14
Nodes (24): Derived row kinds: chef dish, offer, suggestion, Lab's Food draft, Plan-Orchestrate result for FLOW-02 (8 steps, 8a/8b), ECC review chain: tdd-guide, database-reviewer, typescript-reviewer, security-reviewer, PRD: plats, menus, publication et moderation (FLOW-02), Adoption: idempotent copy with lineage and audit-log consent, CHEF_NOT_VERIFIED publication gate, Shopping lists computed deterministically from structured ingredient lists, Direct publication, moderation after the fact (+16 more)

### Community 39 - "Messaging Rules & Contact Release"
Cohesion: 0.11
Nodes (22): J-2 contact release (48h before a confirmed booking), CONTACT_RELEASE_HOURS, DEFAULT_MESSAGE_PAGE_SIZE, isContactReleased(), isWritable(), MAX_ATTACHMENTS_PER_MESSAGE, MAX_BODY_LENGTH, MAX_MESSAGE_PAGE_SIZE (+14 more)

### Community 40 - "Demo Seed Data"
Cohesion: 0.17
Nodes (21): toInputJson(), bookingStatuses, main(), { prisma, pool }, profileStatuses, quoteStatuses, main(), { prisma, pool } (+13 more)

### Community 41 - "CORS & Webhook Raw Body"
Cohesion: 0.15
Nodes (21): registerWebhookRawBodyHook(), CORS_METHODS, corsOptions(), DEVELOPMENT_ORIGINS, isOriginAllowed(), normalize(), PRODUCTION_ORIGINS, resolveAllowedOrigins() (+13 more)

### Community 42 - "Messaging View Types"
Cohesion: 0.13
Nodes (23): currentBooking(), AdminPartyView, AttachmentView, BookingSummary, ClientCardView, ConversationKind, CounterpartView, SenderRole (+15 more)

### Community 43 - "Docker Compose Stack"
Cohesion: 0.13
Nodes (25): api service (apps/Dockerfile, port 8000), postgres service (postgres:16-alpine), redis service (redis:7-alpine), local-dev full-stack docker-compose.yml, admin-dashboard service (port 8035), local-dev api service, batchcooking-web service (port 3005), labsfood-web service (port 3007) (+17 more)

### Community 44 - "NPM Scripts"
Cohesion: 0.08
Nodes (26): scripts, build, db:backfill:clerk, db:backfill:clerk:dry, db:generate, db:migrate, db:migrate:dev, db:resolve (+18 more)

### Community 45 - "Missions Controller"
Cohesion: 0.18
Nodes (19): ApiMissionIdParam(), MissionsController, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+11 more)

### Community 46 - "Bookings Spec Docs"
Cohesion: 0.13
Nodes (26): Booking status pending->confirmed driven by payment webhook, bookings aggregate (spec 'reservation'), Booking reference generator LF-<year>-NNNN, E2 Bookings lifecycle (spec states), E3 Catalog, E5 Quotes, E6 Shopping lists, Module -> spec traceability table (+18 more)

### Community 47 - "Brevo & Cronofy Integrations"
Cohesion: 0.09
Nodes (7): src/modules/dishes module layout (one service per milestone), BrevoService, Injectable, CronofyService, Injectable, DishesMailer, Injectable

### Community 48 - "Bookings Controller"
Cohesion: 0.17
Nodes (18): ApiNotImplementedResponse, ApiBookingIdParam(), BookingsController, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+10 more)

### Community 49 - "Dev Dependencies"
Cohesion: 0.08
Nodes (25): devDependencies, eslint, eslint-config-prettier, eslint-plugin-prettier, husky, jest, lint-staged, @nestjs/cli (+17 more)

### Community 50 - "App & Auth Modules"
Cohesion: 0.15
Nodes (17): AuthModule, Global, Module, CatalogModule, Module, ContactModule, Module, DishesModule (+9 more)

### Community 51 - "TypeScript Config"
Cohesion: 0.08
Nodes (24): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+16 more)

### Community 52 - "Clerk Integration Docs"
Cohesion: 0.14
Nodes (25): Clerk authentication decision, Clerk integration contract (frontend <-> backend), Admin user provisioning (POST /admin/users, PATCH /admin/users/:id/role), POST /auth/register public sign-up, Clerk BAPI email auto-verification risk, First admin bootstrap (manual SQL promotion), GET /me first sign-in sync (ensurePersistedFromClerk), One profile per account (client xor chef) (+17 more)

### Community 53 - "Chef Documents Controller"
Cohesion: 0.18
Nodes (18): ChefDocumentsController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+10 more)

### Community 54 - "Dishes & Menus Rules"
Cohesion: 0.14
Nodes (18): METROPOLITAN_REGIONS, ALLERGENS, declarationProblems(), DeclarationState, DIETS, DISH_CATEGORIES, duplicatesReference(), isRecipeComplete() (+10 more)

### Community 55 - "Pagination Query DTO"
Cohesion: 0.14
Nodes (22): PaginationQueryDto, ApiPropertyOptional, IsInt, IsOptional, Max, Min, Type, ApproveApplicationDto (+14 more)

### Community 56 - "Chef Applications Service"
Cohesion: 0.17
Nodes (5): buildApplicationReference(), ChefApplicationsService, sameValue(), toAnswersView(), Injectable

### Community 57 - "Messaging Admin Service"
Cohesion: 0.16
Nodes (7): AdminConversationView, AdminMessageView, MessagePage, MessagingAdminService, Injectable, LoadedConversation, notFound()

### Community 58 - "Catalog Meal DTOs"
Cohesion: 0.14
Nodes (22): CreateMealDto, CreateMenuWeekDto, MealResponseDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize, IsArray, IsBoolean (+14 more)

### Community 59 - "Chef Onboarding Swagger Examples"
Cohesion: 0.16
Nodes (18): VALIDATION_FAILED, ANSWERS_EXAMPLE, APPLICATION_DETAIL_EXAMPLE, APPROVED_EXAMPLE, CANDIDATURE_EXAMPLE, DECISION_EXAMPLE, DEPOSIT_EXAMPLE, DOCUMENT_STATUS_HELP (+10 more)

### Community 60 - "Dish & Recipe DTOs"
Cohesion: 0.21
Nodes (22): CreateDishDto, IngredientDto, RecipeDto, ReheatingDto, StorageDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+14 more)

### Community 61 - "Avatar Controller"
Cohesion: 0.15
Nodes (17): AvatarController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+9 more)

### Community 62 - "Public User Registration"
Cohesion: 0.12
Nodes (17): RegisterUserDto, ApiProperty, IsEmail, PublicUsersController, ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiOperation (+9 more)

### Community 63 - "Admin Dashboard Spec"
Cohesion: 0.15
Nodes (22): POST /chef-applications candidature sign-up, E10 Stats, E11 Main site / admin-only domains, E4 Client profile & CRM, E9 Notifications, SPEC-ADMIN-DASHBOARD (admin console spec), /admin/* REST API surface, GET /admin/clients pagination ({data, meta}, limit<=100) (+14 more)

### Community 64 - "Stripe Service"
Cohesion: 0.21
Nodes (7): serviceWith(), StripeService, Injectable, CONFIRMABLE_INTENT_STATUSES, StripeWebhooksService, Injectable, stripe

### Community 65 - "Clerk Webhooks"
Cohesion: 0.13
Nodes (13): buildWebhookHeaders(), ClerkWebhooksController, ApiExcludeController, ApiTags, Controller, HttpCode, Post, Req (+5 more)

### Community 66 - "Dual-Role Switcher Analysis"
Cohesion: 0.14
Nodes (14): Analysis: one account, two spaces (client and chef switcher), Client and chef space switcher (dual-role account), Risk: attaching a chef profile to an existing account by email (account takeover), Profile-based authorisation (users.role only gates admin), Self-dealing guard (no booking, quoting or paying your own chef profile), URSSAF avance immediate (50% tax credit for services a la personne), Clerk user.deleted anonymisation (deleted_at tombstone), Security requirements for public account creation (+6 more)

### Community 67 - "Stripe Connect"
Cohesion: 0.14
Nodes (13): StripeConnectController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, Controller, Get (+5 more)

### Community 68 - "SEPA Mandates"
Cohesion: 0.15
Nodes (13): SepaMandatesController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, Controller, Get (+5 more)

### Community 69 - "Chef Applications Admin Service"
Cohesion: 0.27
Nodes (3): toWire(), ChefApplicationsAdminService, Injectable

### Community 70 - "Shopping Lists Service"
Cohesion: 0.24
Nodes (7): Line, formatQuantity(), ShoppingListsService, garlic, lists(), toLine(), Injectable

### Community 71 - "API Docs & CMS Removal Plan"
Cohesion: 0.17
Nodes (17): Plan: API docs pass and CMS removal, Existing wrong behaviour documented as-is (POST /bookings 501, /bookings/me/bookings/:id, ...), OpenAPI check script (NestFactory preview, no database), Swagger pass on every route (summary, description, examples, error codes), Architecture: FLOW-02 dishes, menus, publication and moderation, One migration per milestone (none applied), Optional Brevo and R2 configuration degrades gracefully, HANDOFF: chef onboarding (FLOW-01) and dishes/menus (FLOW-02) (+9 more)

### Community 72 - "Labs Food Content"
Cohesion: 0.19
Nodes (8): CreateLabsFoodMenuDto, ApiPropertyOptional, IsIn, IsOptional, LabsFoodContentService, service(), toAdminMenuView(), Injectable

### Community 73 - "Missions Service (FLOW-02)"
Cohesion: 0.23
Nodes (5): Where the FLOW-02 spec is followed loosely, FLOW-02 known limits (ponytail notes), MissionsService, missions(), Injectable

### Community 74 - "Agent & Dev Guidelines"
Cohesion: 0.19
Nodes (16): AGENTS.md (development and architecture instructions), audit_log: compliance journal and debugging trail, Auth testing without Clerk (sk_test_placeholder decodes JWT without JWKS), In-house messaging (chef_client and support conversations), Raw-body webhook signature verification (preParsing hook), Redis optional (in-process fallback for messaging rate limit and events), Stripe Connect destination charge (booking confirmed only on payment_intent.succeeded), lf-api-nestjs README (apps/) (+8 more)

### Community 75 - "Clerk-to-DB Sync Script"
Cohesion: 0.17
Nodes (13): argv, clerkIdArg, confirmed, emailArg, main(), resolveClerkUsers(), roleArg, syncAll (+5 more)

### Community 76 - "Users-to-Clerk Sync Script"
Cohesion: 0.23
Nodes (11): assertClerkReachable(), clerk, dryRun, main(), previewClerkUser(), { prisma, pool }, isPlaceholderClerkUserId(), isRealClerkSecretKey() (+3 more)

### Community 77 - "Recipe Rules"
Cohesion: 0.27
Nodes (12): aggregate(), applyCorrections(), Correction, diffCorrections(), groupByAisle(), lineKey(), scale(), ail (+4 more)

### Community 78 - "Mission DTOs"
Cohesion: 0.14
Nodes (16): PutShoppingListDto, RecipeSheetQueryDto, ShoppingLineDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize, IsArray, IsInt (+8 more)

### Community 79 - "Nest CLI Config"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 80 - "Fastify Raw Body"
Cohesion: 0.19
Nodes (10): CLERK_WEBHOOK_PATH, getWebhookRawBody(), RawBodyFastifyRequest, STRIPE_WEBHOOK_PATH, WEBHOOK_RAW_BODY_PATHS, HttpCode, Post, Req (+2 more)

### Community 81 - "KYC Storage & Dossier Cron"
Cohesion: 0.19
Nodes (3): Cron, KycStorageService, Injectable

### Community 82 - "Admin Content Photos"
Cohesion: 0.19
Nodes (9): labsFoodPhotoFolder(), PhotoConfirmDto, PhotoUploadDto, ApiProperty, IsIn, IsInt, Matches, Max (+1 more)

### Community 83 - "Chef Onboarding PRD"
Cohesion: 0.16
Nodes (14): Opaque candidate token machinery removed (application-token, guard, resend-link), Admin verification bypass closed (PATCH /admin/chefs/:id/verification answers 409), PRD: batch cooker onboarding (candidature, KYC, admin validation), Submitting a candidature creates a browse-only account, Answers correctable until decision, locked once a validated document proves them, Daily in-process scheduled job for expiry, suspension and retention, Retention purge on the FLOW-01 section 8 schedule, Document requirements computed server-side from the candidate's answers (+6 more)

### Community 84 - "Contact Detection & Masking"
Cohesion: 0.29
Nodes (8): Contact details masked when served, not when stored, CONTACT_MASK, detectContact(), maskContact(), matches(), conversation(), person(), supportConversation()

### Community 85 - "Prisma Env Config"
Cohesion: 0.27
Nodes (7): Env precedence: repo-root .env.local overrides shell exports, url, appsDir, args, findRepoRoot(), loadRepoEnv(), resolveEnvFilePaths()

### Community 86 - "Payment Intents"
Cohesion: 0.21
Nodes (8): PaymentIntentDto, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, Body, HttpCode, Post

### Community 87 - "Profile DTOs"
Cohesion: 0.24
Nodes (11): ApiPropertyOptional, IsArray, IsInt, IsOptional, IsString, Length, Max, Min (+3 more)

### Community 88 - "Prisma Client & DB Connection"
Cohesion: 0.21
Nodes (7): createPrismaClient(), PrismaClientBundle, PrismaLogLevel, isSupabaseCloudUrl(), postgresSsl(), pg, @prisma/adapter-pg

### Community 89 - "Booking & Meal Ownership Gaps"
Cohesion: 0.18
Nodes (6): GET /bookings returns every booking (no admin guard), Explicit owner rule in every module reading meals, Extend meals into the chef-owned dish (no second table), Recipes never exposed publicly (section 8), BookingsService, Injectable

### Community 90 - "Create Booking DTO"
Cohesion: 0.18
Nodes (11): CreateBookingDto, ApiProperty, ApiPropertyOptional, IsInt, IsOptional, IsString, IsUUID, Length (+3 more)

### Community 91 - "Payments Webhook Handlers"
Cohesion: 0.24
Nodes (3): idOf(), PaymentsService, Injectable

### Community 92 - "Dish Ownership Plan"
Cohesion: 0.22
Nodes (8): One access rule: 404 on read, 403 CONTENT_NOT_OWNED on write, Plan: Dishes have owners (FLOW-02 milestone 1), 403 CONTENT_NOT_OWNED error code, meals.chef_profile_id (owner, Cascade) and created_by_user_id (author, SetNull), Known pre-existing issues: lint errors in src/generated, registerClient TTL test, A chef never reads or copies another chef's content, FLOW-02 M1: Dishes have owners, Ownership (chef_profile_id) separate from authorship (created_by_user_id)

### Community 93 - "Brevo Templates PRD"
Cohesion: 0.27
Nodes (9): Sign-in link emailed only, never in the HTTP response, Transactional email via Brevo hosted templates (BREVO_TPL_* ids as config), PRD: Brevo email templates (HTML sources, safety tests, editing workflow), No template engine (EJS, Handlebars, Pug rejected), Brevo Pongo2 template language (auto-escaped variables), postmark-cli templates push/pull (repo-as-source model), Six node:test template security rules, upload.mjs --check / --update / --force (repo as source of truth) (+1 more)

### Community 94 - "Clerk User Payload"
Cohesion: 0.40
Nodes (6): ClerkProfileFields, clerkProfileFromBapiUser(), clerkProfileFromUserJson(), fullNameFromClerkUser(), primaryEmailFromClerkUser(), primaryPhoneFromClerkUser()

### Community 95 - "Referentials Controller"
Cohesion: 0.40
Nodes (6): ReferentialsController, ApiOkResponse, ApiOperation, ApiTags, Controller, Get

### Community 96 - "Health Controller"
Cohesion: 0.24
Nodes (7): HealthController, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, HealthCheck

### Community 97 - "Payments Module & Stripe Webhooks"
Cohesion: 0.20
Nodes (8): PaymentsModule, Module, StripeWebhooksController, ApiExcludeController, ApiTags, Controller, StripeWebhooksModule, Module

### Community 98 - "SAP Profile DTO"
Cohesion: 0.22
Nodes (10): SapProfileDto, ApiProperty, ApiPropertyOptional, IsIn, IsOptional, IsString, Length, ValidateIf (+2 more)

### Community 99 - "Jest Config"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 100 - "Chef Profile DTO"
Cohesion: 0.22
Nodes (9): ChefProfileFieldsDto, ApiProperty, ApiPropertyOptional, IsInt, IsOptional, IsString, Length, Max (+1 more)

### Community 101 - "Chef Onboarding Migration"
Cohesion: 0.25
Nodes (6): Dossier status derived from documents, never stored as input, Append-only chef_documents owned by the chef profile from first upload, Legacy tables renamed aside to *_legacy, not dropped, "audit_log", "chef_applications", "chef_documents"

### Community 103 - "TS Build Config"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, tsBuildInfoFile, exclude, extends, include, ./tsconfig.json

### Community 104 - "Countries Referential"
Cohesion: 0.38
Nodes (5): ALPHA2_TO_NUMERIC, COUNTRIES_TOTAL, country(), COUNTRY_CODES, frenchNames

### Community 105 - "Stripe Connect DTOs"
Cohesion: 0.48
Nodes (6): SepaMandateSetupIntentDto, SepaMandateStatusDto, StripeConnectLinkDto, StripeConnectStatusDto, ApiProperty, ApiPropertyOptional

### Community 106 - "Docker CI Workflow"
Cohesion: 0.33
Nodes (5): Docker image workflow (GitHub Actions), build-run-push job, Publish image to GHCR on pushes and tags, never on PRs, Smoke test: migrate, boot, /health and /ready against a throwaway Postgres, docker-entrypoint.sh script

### Community 107 - "Bookings & Shopping Modules"
Cohesion: 0.40
Nodes (4): BookingsModule, Module, ShoppingListsModule, Module

### Community 108 - "Booking Read DTO"
Cohesion: 0.40
Nodes (3): BookingReadDto, ApiProperty, UserRoleEnum

### Community 109 - "Messaging Notifier Cron"
Cohesion: 0.40
Nodes (3): MessagingNotifierCron, Cron, Injectable

### Community 110 - "Payments Controller"
Cohesion: 0.33
Nodes (5): PaymentsController, ApiBearerAuth, ApiTags, Controller, UseGuards

### Community 111 - "CMS Removal & KYC Notes"
Cohesion: 0.50
Nodes (4): CMS removal (content-cms module, CmsPage model, cms_pages table), KYC files in a private Supabase Storage bucket with signed upload and read, Dish, menu and profile photos on Cloudflare R2, presigned and moderated, Third-party services (Clerk, Cronofy, Brevo, Stripe, Google Maps, Cloudflare R2, Supabase Storage)

### Community 112 - "Commission Calculation"
Cohesion: 0.60
Nodes (3): CommissionBreakdown, CommissionRates, computeCommission()

### Community 113 - "Payments SAP SEPA Migration"
Cohesion: 0.50
Nodes (3): "commissions", "sap_profiles", "sepa_mandates"

### Community 114 - "CORS Smoke Test"
Cohesion: 0.50
Nodes (3): PingController, Controller, Get

### Community 115 - "Env Validation"
Cohesion: 0.50
Nodes (3): envValidationSchema, Add Brevo template workflow, joi

### Community 116 - "Gateway Auth Handler"
Cohesion: 0.50
Nodes (3): ConnectedSocket, MessageBody, SubscribeMessage

### Community 117 - "Redis Module"
Cohesion: 0.50
Nodes (3): RedisModule, Global, Module

### Community 118 - "Audit Module"
Cohesion: 0.67
Nodes (3): AuditModule, Global, Module

### Community 119 - "Integrations Module"
Cohesion: 0.67
Nodes (3): IntegrationsModule, Global, Module

## Ambiguous Edges - Review These
- `Redis optional (in-process fallback for messaging rate limit and events)` → `lf-api-nestjs README (apps/)`  [AMBIGUOUS]
  apps/README.md · relation: conceptually_related_to
- `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` → `labsfood-web service (port 3007)`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to
- `In-house messaging module` → `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to
- `Clerk authentication decision` → `POST /auth/register public sign-up`  [AMBIGUOUS]
  docs/architecture.md · relation: conceptually_related_to
- `In-house messaging (modules/messaging, Stream dropped)` → `Railway deployment (apps/Dockerfile + railway.toml)`  [AMBIGUOUS]
  docs/deploy/railway.md · relation: conceptually_related_to
- `POST /chef-applications candidature sign-up` → `E11 Main site / admin-only domains`  [AMBIGUOUS]
  docs/evolution/platform-spec-alignment-evolution.md · relation: conceptually_related_to
- `Railway deployment (apps/Dockerfile + railway.toml)` → `Object storage: R2 for public media, Supabase Storage for private docs, S3 dropped`  [AMBIGUOUS]
  docs/deploy/railway.md · relation: conceptually_related_to
- `Booking reference generator LF-<year>-NNNN` → `E2 Bookings lifecycle (spec states)`  [AMBIGUOUS]
  docs/evolution/platform-spec-alignment-evolution.md · relation: conceptually_related_to
- `E3 Catalog` → `Module -> spec traceability table`  [AMBIGUOUS]
  docs/evolution/platform-spec-alignment-evolution.md · relation: conceptually_related_to

## Knowledge Gaps
- **368 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `tsConfigPath` (+363 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 856 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Redis optional (in-process fallback for messaging rate limit and events)` and `lf-api-nestjs README (apps/)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` and `labsfood-web service (port 3007)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `In-house messaging module` and `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Clerk authentication decision` and `POST /auth/register public sign-up`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `In-house messaging (modules/messaging, Stream dropped)` and `Railway deployment (apps/Dockerfile + railway.toml)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `POST /chef-applications candidature sign-up` and `E11 Main site / admin-only domains`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Railway deployment (apps/Dockerfile + railway.toml)` and `Object storage: R2 for public media, Supabase Storage for private docs, S3 dropped`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._