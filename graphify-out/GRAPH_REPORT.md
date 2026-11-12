# Graph Report - LF-BackEnd  (2026-11-12)

## Corpus Check
- 480 files · ~356,860 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5001 nodes · 14757 edges · 250 communities (199 shown, 23 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 870 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `aa28ec42`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- UsersService
- .reply
- CurrentClerkUser
- ApiAdminAuthResponses
- user-response.dto.ts
- .reapply
- .setZones
- chef-onboarding.rules.ts
- MeContentController
- moderation.service.ts
- vitrine.service.ts
- .chef
- 20250522130000_spec_domain/migration.sql
- suggestions.service.ts
- .chefIdentity
- CreateMenuDto
- messaging.gateway.ts
- Backend architecture
- Body
- package.json
- dishes.test-helpers.ts
- .updateMeal
- AdminContentController
- admin-conversations.controller.ts
- dishes.service.ts
- booking-withdrawals.service.ts
- MessagingService
- R2StorageService
- ClerkUser
- AdminConversationsController
- Query
- Brevo shared email layout
- .decideDocument
- PrismaService
- upload.mjs
- dependencies
- menus.service.ts
- KycStorageService
- bookings.views.ts
- demo-seed-constants.ts
- allowed-origins.ts
- messaging.service.ts
- stack.md
- scripts
- .submit
- availability.service.ts
- contact.service.ts
- chef-applications.service.ts
- devDependencies
- app.module.ts
- compilerOptions
- Clerk integration contract (frontend ↔ backend)
- .confirm
- dishes.rules.ts
- class-validator
- ChefApplicationsService
- MessagingAdminService
- CreateMealDto
- chef-documents.controller.ts
- dish.dto.ts
- PaymentInvoicesService
- public-users.controller.ts
- cesu-payments.service.ts
- @nestjs/common
- clerk-webhooks.controller.ts
- Analysis: one account, two spaces (client and chef switcher)
- sepa-mandates.controller.ts
- SepaMandatesService
- .record
- ShoppingListsService
- withdrawal.rules.ts
- .deleteUser
- platform-settings.service.ts
- AGENTS.md (development and architecture instructions)
- sync-clerk-to-db.ts
- sync-users-to-clerk.ts
- recipes.rules.ts
- mission.dto.ts
- nest-cli.json
- allergies.rules.ts
- CesuPaymentsService
- ContentPhotosService
- main.ts
- messaging.service.spec.ts
- env-files.ts
- .createCheckoutSession
- profile.dto.ts
- db-connection.ts
- BookingsService
- bookings.dto.ts
- .handleVerifiedEvent
- 4. Juridique
- clerk-user-payload.ts
- ReferentialsController
- HealthController
- StripeWebhooksService
- UpdateMeSapProfileDto
- jest
- ChefProfileFieldsDto
- 20260920120000_chef_onboarding/migration.sql
- MessagingStorageService
- tsconfig.build.json
- countries.ts
- contract-documents.ts
- build-run-push job
- QuotesService
- index.ts
- .notify
- bookings.service.ts
- commission-policy.ts
- 20260831120000_payments_sap_sepa_foundations/migration.sql
- .ensurePersistedFromClerk
- env.validation.ts
- ApiBookingId
- redis.module.ts
- AuditModule
- IntegrationsModule
- AppModule
- HealthModule
- DatabaseModule
- pre-commit
- Feature request issue template ([FEATXXX])
- "chef_profiles"
- "chef_profiles"
- "chef_profiles"
- "chef_applications"
- CreateQuoteDto
- QuoteOffersService
- ApiClerkAuthResponses
- .feed
- content.errors.ts
- .outcome
- booking-reschedules.service.ts
- .addBlock
- availability.dto.ts
- CommissionDebitsService
- .retryDebit
- class-transformer
- contact.dto.ts
- booking-documents.service.ts
- me-bookings.controller.ts
- quote.rules.ts
- Deploy LF-BackEnd on Railway
- .sendTemplate
- BookingPaymentsService
- ListItemDto
- .update
- 1. Site client (`batchcooking-web`)
- .create
- Plan d'audit de sécurité — LF-BackEnd
- Evolution Register — Payments (Stripe CB, Connect, commissions, SAP/SEPA foundations)
- booking-audiences.controller.spec.ts
- StatsService
- 3. Endpoints
- global-throttler.smoke.spec.ts
- CatalogService
- classification.rules.ts
- quote-offers.service.ts
- .replace
- service-offers.service.ts
- PaymentsService
- chef-legal.views.ts
- [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02)
- /lf-security-audit
- contract-documents.spec.ts
- WeekMenusQueryDto
- booking-payments.dto.ts
- fiscal-attestations.service.ts
- Clerk identity + Supabase/Prisma app data
- Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine
- ContactService
- .slots
- admin-chefs.dto.ts
- admin-chefs.service.ts
- F19 - Page "Notre Concept" CMS
- CreateCheckoutSessionDto
- CreateServiceOfferDto
- ServiceOffersService
- In-house batch cooker calendar
- Supabase Postgres connection (LF-BackEnd)
- Controller
- ics.ts
- ConfirmUploadDto
- payment-invoices.rules.ts
- AdminChefsService
- UrssafGateway
- quote.views.ts
- UpdateChefLegalDto
- Role-segmented bookings, batch cooker availability and Cronofy
- catalog.module.ts
- recipe-document.ts
- CreateAdminUserDto
- overrides
- swagger.ts
- client-onboarding.rules.ts
- templates.test.mjs
- Phase C: Cronofy (connect, free/busy, events), data center `de`
- Phase D1: the agenda, fitted to the page
- Rapport d'audit sécurité — LF-BackEnd — 2026-10-24 (run `--quick`)
- ListAdminChefsQueryDto
- chef-profile.dto.ts
- Phase A: role-segmented bookings
- Phase B: working hours and computed availability (no Cronofy needed)
- Phase L: error handling and logging, for every phase below
- booking-reschedules.service.spec.ts
- Phase S: a temporary `disputed` status
- Rapport d'audit sécurité — LF-BackEnd — 2026-10-20 (run `--quick`)
- 20260905120000_payments_cesu_commission_debits/migration.sql
- RoutesController
- Phase D1b: what clients see
- 20261014130000_chef_availability/migration.sql
- ListAdminClientsQueryDto
- "chef_time_blocks"
- "chef_calendar_feeds"
- .expireUnpaid
- 20261102160000_catalog_ingredients/migration.sql
- 20261102190000_payment_invoices/migration.sql
- 20261110100000_chef_ingredients/migration.sql
- commit-msg
- "chef_profiles"
- "chef_profiles"
- "chef_profiles"

## God Nodes (most connected - your core abstractions)
1. `ClerkUser` - 251 edges
2. `CurrentClerkUser` - 239 edges
3. `@nestjs/common` - 212 edges
4. `ApiClerkAuthResponses()` - 187 edges
5. `PrismaService` - 153 edges
6. `UsersService` - 148 edges
7. `ApiAdminAuthResponses()` - 131 edges
8. `Body` - 120 edges
9. `@nestjs/swagger` - 90 edges
10. `AuditService` - 75 edges

## Surprising Connections (you probably didn't know these)
- `Automatic-suspension episode (chef_profiles.auto_suspended_at)` --references--> `ChefDossierCron`  [INFERRED]
  AGENTS.md → apps/src/modules/chef-onboarding/services/chef-dossier.cron.ts
- `client / chef / admin roles` --references--> `AdminGuard`  [EXTRACTED]
  stack.md → apps/src/auth/admin.guard.ts
- `Auth testing without Clerk (sk_test_placeholder decodes JWT without JWKS)` --references--> `ClerkAuthGuard`  [EXTRACTED]
  AGENTS.md → apps/src/auth/clerk-auth.guard.ts
- `Append-only chef_documents owned by the chef profile from first upload` --references--> `ChefDocumentsService`  [INFERRED]
  AGENTS.md → apps/src/modules/chef-onboarding/services/chef-documents.service.ts
- `Contact forms: stored first, emailed second` --references--> `ContactService`  [INFERRED]
  AGENTS.md → apps/src/modules/contact/contact.service.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Brevo template sync pipeline** — brevo_readme, brevo_layout, brevo_templates, brevo_upload, brevo_templates_test, brevo_upload_test, brevo_readme_upload_drift_detection [EXTRACTED 1.00]
- **KYC document expiry and suspension flow** — brevo_templates_brevo_tpl_document_expiring, brevo_templates_brevo_tpl_chef_suspended, brevo_templates_brevo_tpl_document_rejected, stack_supabase_storage [INFERRED 0.75]
- **Chef application lifecycle emails** — brevo_templates_brevo_tpl_application_received, brevo_templates_brevo_tpl_application_received_admin, brevo_templates_brevo_tpl_changes_requested, brevo_templates_brevo_tpl_document_rejected, brevo_templates_brevo_tpl_application_approved, brevo_templates_brevo_tpl_application_rejected, brevo_templates_brevo_tpl_sign_in_link, apps_src_modules_chef_onboarding_services_chef_onboarding_mailer_chefonboardingmailer [INFERRED 0.85]

## Communities (250 total, 23 thin omitted)

### Community 0 - "UsersService"
Cohesion: 0.04
Nodes (31): ClerkProfileFields, MAX_BOOKING_PHOTOS, STARTED, END, MORNINGS, START, mockedVerifyWebhook, ROW (+23 more)

### Community 1 - ".reply"
Cohesion: 0.14
Nodes (19): AdminContactController, ApiMessageIdParam(), ContactController, reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse (+11 more)

### Community 2 - "CurrentClerkUser"
Cohesion: 0.14
Nodes (30): CurrentClerkUser, ACCEPTED, AdminQuotesController, ApiOfferIdParam(), ApiQuoteIdParam(), CHEF, ChefQuotesController, OFFER (+22 more)

### Community 3 - "ApiAdminAuthResponses"
Cohesion: 0.05
Nodes (80): AdminGuard, Injectable, assertClerkConfigured(), ClerkAuthGuard, decodeUnverifiedJwt(), JwtClaims, resolveClaims(), resolveClerkUser() (+72 more)

### Community 4 - "user-response.dto.ts"
Cohesion: 0.20
Nodes (19): PaginationMetaDto, ApiProperty, USER_ROLES, RegisterResponseDto, ApiProperty, AdminClientDto, AdminClientListItemDto, AdminUserListItemDto (+11 more)

### Community 5 - ".reapply"
Cohesion: 0.11
Nodes (24): ChefApplicationsController, MyChefApplicationController, reqId(), ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse (+16 more)

### Community 6 - ".setZones"
Cohesion: 0.19
Nodes (14): AdminChefsController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+6 more)

### Community 7 - "chef-onboarding.rules.ts"
Cohesion: 0.05
Nodes (49): AuditActorType, ApplicationAnswers, AWAITING_DECISION, buildApplicationReference(), canApprove(), COUNTS_AS_VALID, deriveDossierStatus(), DOCUMENT_FAMILY (+41 more)

### Community 8 - "MeContentController"
Cohesion: 0.15
Nodes (32): PhotoConfirmDto, PhotoUploadDto, ApiProperty, IsIn, IsInt, Matches, Max, Min (+24 more)

### Community 9 - "moderation.service.ts"
Cohesion: 0.06
Nodes (49): AdminModerationController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+41 more)

### Community 10 - "vitrine.service.ts"
Cohesion: 0.17
Nodes (21): coveredDiets(), coversArea(), InterventionZone, parisClock, parisDay(), parisMidnight(), rotationKey(), vitrineOrder() (+13 more)

### Community 11 - ".chef"
Cohesion: 0.10
Nodes (17): ChefContentService, Injectable, changedMeanwhile(), DishesService, goneMeanwhile(), Injectable, chefNotVerified(), nextReviewReason() (+9 more)

### Community 12 - "20250522130000_spec_domain/migration.sql"
Cohesion: 0.05
Nodes (51): "availability_slots", "bookings", "cms_pages", "provider_profiles", "service_offers", "users", "admin_settings", "application_documents" (+43 more)

### Community 13 - "suggestions.service.ts"
Cohesion: 0.10
Nodes (24): DishesMailer, Injectable, computed(), seasonsOf(), toDishSummary(), toDishView(), toModeration(), toPublicDish() (+16 more)

### Community 14 - ".chefIdentity"
Cohesion: 0.06
Nodes (46): COMPUTED_DIET_CODES, AdoptIngredientDto, CatalogIngredientDto, ListCatalogIngredientsQueryDto, SearchIngredientsQueryDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+38 more)

### Community 15 - "CreateMenuDto"
Cohesion: 0.11
Nodes (23): CreateMenuDto, MENU_PERIODS, PutShowcaseWeeksDto, ShowcaseAssignmentDto, ShowcaseRangeQueryDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+15 more)

### Community 16 - "messaging.gateway.ts"
Cohesion: 0.06
Nodes (19): SEND_RATE_LIMIT, MessagingGateway, SocketState, RealtimeEnvelope, RealtimeEvent, Listener, MessagingEventsService, Injectable (+11 more)

### Community 17 - "Backend architecture"
Cohesion: 0.11
Nodes (19): Admin backlog (SPEC-ADMIN-DASHBOARD), API surface summary, Authentication, Backend architecture, Booking lifecycle, Client / public backlog (SPEC-BACKEND), Current module layout (implemented), Data model direction (+11 more)

### Community 18 - "Body"
Cohesion: 0.12
Nodes (29): ApiExtraModels, Body, IsString, Length, Type, ValidateNested, ApiPropertyOptional, IsBoolean (+21 more)

### Community 19 - "package.json"
Cohesion: 0.05
Nodes (41): author, commitlint, extends, description, keywords, license, lint-staged, {src,test}/**/*.ts (+33 more)

### Community 20 - "dishes.test-helpers.ts"
Cohesion: 0.20
Nodes (16): adminRow(), CHEF, codeOf(), dishRow(), harness(), menuRow(), readyDishRow(), UNMODERATED (+8 more)

### Community 21 - ".updateMeal"
Cohesion: 0.21
Nodes (21): ApiMealIdParam(), ApiMenuWeekIdParam(), CatalogController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse (+13 more)

### Community 22 - "AdminContentController"
Cohesion: 0.11
Nodes (34): AdminContentController, ApiMenuIdParam(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse (+26 more)

### Community 23 - "admin-conversations.controller.ts"
Cohesion: 0.10
Nodes (34): AdminListConversationsQueryDto, AttachmentRefDto, CreateAttachmentUploadDto, ListMessagesQueryDto, OpenConversationDto, OpenSupportConversationDto, SendMessageDto, ApiProperty (+26 more)

### Community 24 - "dishes.service.ts"
Cohesion: 0.12
Nodes (38): assertPublishable(), declarationOf(), isDeclared(), LABS_FOOD, NOT_LABS_FOOD, safetyChanged(), touchesDeclaration(), WITH_MEALS (+30 more)

### Community 25 - "booking-withdrawals.service.ts"
Cohesion: 0.07
Nodes (23): buildPaginationMeta(), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageBounds, Paginated, resolvePageBounds(), CGV_BYTES, FORM_BYTES (+15 more)

### Community 26 - "MessagingService"
Cohesion: 0.14
Nodes (10): PairBooking, ConversationDetailView, ConversationView, MessageView, isUniqueViolation(), MessagingService, notFound(), toMessageView() (+2 more)

### Community 27 - "R2StorageService"
Cohesion: 0.05
Nodes (34): detectImageType(), MAX_PHOTO_BYTES, PHOTO_TYPES, photoKey(), R2Config, R2StorageService, CONFIG, configured() (+26 more)

### Community 28 - "ClerkUser"
Cohesion: 0.14
Nodes (22): FakeRequest, ClerkUser, FakeRequest, mockedVerifyToken, ApiConversationIdParam(), MeConversationsController, ApiBearerAuth, ApiConflictResponse (+14 more)

### Community 29 - "AdminConversationsController"
Cohesion: 0.21
Nodes (18): AdminConversationsController, ApiConversationIdParam(), reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse (+10 more)

### Community 30 - "Query"
Cohesion: 0.06
Nodes (41): Query, IsBoolean, IsOptional, ApiChefIdParam(), PublicVitrineController, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+33 more)

### Community 31 - "Brevo shared email layout"
Cohesion: 0.21
Nodes (17): Brevo shared email layout, params: line contract, signInUrl invariant, Application approved email (BREVO_TPL_APPLICATION_APPROVED), Application received email (BREVO_TPL_APPLICATION_RECEIVED), Application received admin email (BREVO_TPL_APPLICATION_RECEIVED_ADMIN), Application rejected email (BREVO_TPL_APPLICATION_REJECTED), Changes requested email (BREVO_TPL_CHANGES_REQUESTED) (+9 more)

### Community 32 - ".decideDocument"
Cohesion: 0.22
Nodes (19): ApiApplicationIdParam(), ChefApplicationsAdminController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse (+11 more)

### Community 33 - "PrismaService"
Cohesion: 0.07
Nodes (18): AuditEntry, AuditService, Injectable, ClerkService, Injectable, ANSWERS, NOTES_OPEN, Role (+10 more)

### Community 34 - "upload.mjs"
Cohesion: 0.15
Nodes (12): Upload digest drift detection, dir, layout, templates, byName, [check, update, force], compare(), digest() (+4 more)

### Community 35 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, class-transformer, class-validator, @clerk/backend, @fastify/helmet, @fastify/static (+23 more)

### Community 36 - "menus.service.ts"
Cohesion: 0.19
Nodes (14): isDisabledByAdmin(), ChefContext, MENU_DISHES, MenuWithDishes, chefPhotoFolder(), PhotoKind, plural(), contentNotOwned() (+6 more)

### Community 37 - "KycStorageService"
Cohesion: 0.10
Nodes (12): SupabaseService, Injectable, ALLOWED_MIME_TYPES, DOWNLOAD_URL_TTL_SECONDS, KycStorageService, MAX_FILE_BYTES, SignedUpload, Injectable (+4 more)

### Community 39 - "bookings.views.ts"
Cohesion: 0.24
Nodes (14): BOOKING_DETAIL_INCLUDE, BOOKING_LIST_INCLUDE, checkOf(), DetailRow, ListRow, paidOf(), toBookingDetail(), toBookingListItem() (+6 more)

### Community 40 - "demo-seed-constants.ts"
Cohesion: 0.10
Nodes (35): toInputJson(), bookingStatuses, main(), { prisma, pool }, profileStatuses, quoteStatuses, main(), { prisma, pool } (+27 more)

### Community 41 - "allowed-origins.ts"
Cohesion: 0.14
Nodes (18): CORS_METHODS, corsOptions(), DEVELOPMENT_ORIGINS, isOriginAllowed(), normalize(), PRODUCTION_ORIGINS, resolveAllowedOrigins(), AppConfig (+10 more)

### Community 42 - "messaging.service.ts"
Cohesion: 0.07
Nodes (44): J-2 contact release (48h before a confirmed booking), GOING_AHEAD, CONTACT_RELEASE_HOURS, currentBooking(), DEFAULT_MESSAGE_PAGE_SIZE, isContactReleased(), isWritable(), MAX_ATTACHMENTS_PER_MESSAGE (+36 more)

### Community 43 - "stack.md"
Cohesion: 0.13
Nodes (25): api service (apps/Dockerfile, port 8000), postgres service (postgres:16-alpine), redis service (redis:7-alpine), local-dev full-stack docker-compose.yml, admin-dashboard service (port 8035), local-dev api service, batchcooking-web service (port 3005), labsfood-web service (port 3007) (+17 more)

### Community 44 - "scripts"
Cohesion: 0.08
Nodes (26): scripts, build, db:backfill:clerk, db:backfill:clerk:dry, db:generate, db:migrate, db:migrate:dev, db:resolve (+18 more)

### Community 45 - ".submit"
Cohesion: 0.28
Nodes (17): ApiMissionIdParam(), MissionsController, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+9 more)

### Community 46 - "availability.service.ts"
Cohesion: 0.09
Nodes (34): DAY_MS, parisMinute(), weekdayOf(), ymd(), BLOCK_SELECT, MAX_BLOCKS_AHEAD, requestWindow(), FROM (+26 more)

### Community 47 - "contact.service.ts"
Cohesion: 0.10
Nodes (14): BrevoService, ChefOnboardingEmail, Injectable, DAY, WHEN, Loaded, SOURCE_LABEL, FORM (+6 more)

### Community 48 - "chef-applications.service.ts"
Cohesion: 0.07
Nodes (18): communeKey(), matchCommune(), FAILED, GeoFailure, GeoService, Injectable, DECLARED, OFFER (+10 more)

### Community 49 - "devDependencies"
Cohesion: 0.07
Nodes (28): devDependencies, @commitlint/cli, @commitlint/config-conventional, eslint, eslint-config-prettier, eslint-plugin-prettier, husky, jest (+20 more)

### Community 50 - "app.module.ts"
Cohesion: 0.12
Nodes (26): AllergiesModule, Module, BookingsModule, Module, CalendarModule, Module, ChefOnboardingModule, Module (+18 more)

### Community 51 - "compilerOptions"
Cohesion: 0.08
Nodes (24): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+16 more)

### Community 52 - "Clerk integration contract (frontend ↔ backend)"
Cohesion: 0.09
Nodes (23): A. Sign-up → DB sync (simulates frontend), Admin user provisioning, B. Sign-in → protected API, BAPI email verification note, C. Bootstrap first admin, Chef vetting, Clerk integration contract (frontend ↔ backend), Code map (+15 more)

### Community 53 - ".confirm"
Cohesion: 0.20
Nodes (17): ChefDocumentsController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+9 more)

### Community 54 - "dishes.rules.ts"
Cohesion: 0.14
Nodes (18): ALLERGEN_CODES, ALLERGENS, COMPUTED_DIETS, DeclarationState, DIETS, DISH_CATEGORIES, duplicatesReference(), isObject() (+10 more)

### Community 55 - "class-validator"
Cohesion: 0.08
Nodes (31): PaginationQueryDto, ApiPropertyOptional, IsInt, IsOptional, Max, Min, Type, QueryBoolean() (+23 more)

### Community 56 - "ChefApplicationsService"
Cohesion: 0.23
Nodes (4): CreateChefApplicationDto, ArrayMinSize, ChefApplicationsService, Injectable

### Community 57 - "MessagingAdminService"
Cohesion: 0.17
Nodes (6): AdminConversationView, AdminMessageView, MessagePage, MessagingAdminService, Injectable, LoadedConversation

### Community 58 - "CreateMealDto"
Cohesion: 0.09
Nodes (27): CONTINENTS, CreateMealDto, CreateMenuWeekDto, DIFFICULTIES, MEAL_STATUSES, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+19 more)

### Community 59 - "chef-documents.controller.ts"
Cohesion: 0.15
Nodes (18): VALIDATION_FAILED, ANSWERS_EXAMPLE, APPLICATION_DETAIL_EXAMPLE, APPROVED_EXAMPLE, CANDIDATURE_EXAMPLE, DECISION_EXAMPLE, DEPOSIT_EXAMPLE, DOCUMENT_STATUS_HELP (+10 more)

### Community 60 - "dish.dto.ts"
Cohesion: 0.19
Nodes (27): CreateDishDto, DIFFICULTIES, FREE_TEXT, IngredientDto, RecipeDto, ReheatingDto, StepDto, StorageDto (+19 more)

### Community 61 - "PaymentInvoicesService"
Cohesion: 0.09
Nodes (27): BackfilledInvoiceDto, BackfillFailureDto, BackfillPaymentInvoicesDto, DocumentLinkDto, PaymentInvoiceBackfillResultDto, PaymentInvoiceDto, ApiProperty, ApiPropertyOptional (+19 more)

### Community 62 - "public-users.controller.ts"
Cohesion: 0.13
Nodes (15): RegisterUserDto, ApiProperty, IsEmail, PublicUsersController, ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiOperation (+7 more)

### Community 63 - "cesu-payments.service.ts"
Cohesion: 0.08
Nodes (29): withdrawalRefused(), BookingPaymentState, MethodReasonCode, PaymentMethodOption, REASONS, URSSAF_REASON, UrssafReasonCode, CESU_PAYMENT_INCLUDE (+21 more)

### Community 64 - "@nestjs/common"
Cohesion: 0.07
Nodes (43): serviceWith(), StripeService, Injectable, LEGACY_KEY_VARS, COMMISSION_FOR_INVOICE_SELECT, CommissionForInvoice, CommissionInvoiceView, DEBITABLE_COMMISSION_STATUSES (+35 more)

### Community 65 - "clerk-webhooks.controller.ts"
Cohesion: 0.11
Nodes (18): CLERK_WEBHOOK_PATH, getWebhookRawBody(), RawBodyFastifyRequest, registerWebhookRawBodyHook(), STRIPE_WEBHOOK_PATH, WEBHOOK_RAW_BODY_PATHS, buildWebhookHeaders(), ClerkWebhooksController (+10 more)

### Community 66 - "Analysis: one account, two spaces (client and chef switcher)"
Cohesion: 0.43
Nodes (6): Analysis: one account, two spaces (client and chef switcher), Client and chef space switcher (dual-role account), Risk: attaching a chef profile to an existing account by email (account takeover), Profile-based authorisation (users.role only gates admin), Self-dealing guard (no booking, quoting or paying your own chef profile), URSSAF avance immediate (50% tax credit for services a la personne)

### Community 67 - "sepa-mandates.controller.ts"
Cohesion: 0.08
Nodes (33): ConfirmSepaMandateDto, CreateSepaMandateCheckoutDto, SepaMandateCheckoutDto, SepaMandateSetupIntentDto, StripeConnectLinkDto, StripeConnectStatusDto, ApiProperty, IsString (+25 more)

### Community 68 - "SepaMandatesService"
Cohesion: 0.21
Nodes (6): SepaMandateStatusDto, ApiPropertyOptional, idOf(), SepaMandatesService, Injectable, customerRef()

### Community 69 - ".record"
Cohesion: 0.18
Nodes (5): toWire(), ChefApplicationsAdminService, Injectable, sameValue(), toAnswersView()

### Community 70 - "ShoppingListsService"
Cohesion: 0.13
Nodes (10): Line, MissionsService, missions(), Injectable, shoppingDeadline(), formatQuantity(), ShoppingListsService, garlic (+2 more)

### Community 71 - "withdrawal.rules.ts"
Cohesion: 0.10
Nodes (28): contractConsentRequired(), WITHDRAWAL_MESSAGE, chefShops(), consentsAuditMetadata(), ConsentsInput, CONTRACT_TERMS, ContractGap, contractGaps() (+20 more)

### Community 72 - ".deleteUser"
Cohesion: 0.11
Nodes (22): BOOKING_STATUSES, AccountDeletionController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+14 more)

### Community 73 - "platform-settings.service.ts"
Cohesion: 0.09
Nodes (35): SupplementRules, SUPPLEMENTS_KEY, CHEF_CAPABILITIES, CHEF_TIERS_KEY, chefTierLabels(), chefTierRules(), DECIDED_CHEF_TIERS, DEFAULT_CHEF_TIER_LABELS (+27 more)

### Community 74 - "AGENTS.md (development and architecture instructions)"
Cohesion: 0.19
Nodes (16): AGENTS.md (development and architecture instructions), audit_log: compliance journal and debugging trail, Auth testing without Clerk (sk_test_placeholder decodes JWT without JWKS), In-house messaging (chef_client and support conversations), Raw-body webhook signature verification (preParsing hook), Redis optional (in-process fallback for messaging rate limit and events), Stripe Connect destination charge (booking confirmed only on payment_intent.succeeded), Automatic-suspension episode (chef_profiles.auto_suspended_at) (+8 more)

### Community 75 - "sync-clerk-to-db.ts"
Cohesion: 0.17
Nodes (13): argv, clerkIdArg, confirmed, emailArg, main(), resolveClerkUsers(), roleArg, syncAll (+5 more)

### Community 76 - "sync-users-to-clerk.ts"
Cohesion: 0.23
Nodes (11): assertClerkReachable(), clerk, dryRun, main(), previewClerkUser(), { prisma, pool }, isPlaceholderClerkUserId(), isRealClerkSecretKey() (+3 more)

### Community 77 - "recipes.rules.ts"
Cohesion: 0.13
Nodes (26): aggregate(), applyCorrections(), canonical(), Correction, diffCorrections(), fold(), groupByAisle(), householdPortions() (+18 more)

### Community 78 - "mission.dto.ts"
Cohesion: 0.18
Nodes (21): PutDishNotesDto, PutShoppingListDto, RecipeSheetQueryDto, ShoppingLineDto, ShoppingMarkDto, SubmitShoppingListDto, ApiProperty, ApiPropertyOptional (+13 more)

### Community 79 - "nest-cli.json"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 80 - "allergies.rules.ts"
Cohesion: 0.12
Nodes (27): EARLIER, UPCOMING, allergyCheck(), allergyLabels(), AllergyReason, checkable(), CLIENT_ALLERGY_SELECT, ClientAllergies (+19 more)

### Community 81 - "CesuPaymentsService"
Cohesion: 0.07
Nodes (48): CesuPaymentsController, PublicCesuController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+40 more)

### Community 82 - "ContentPhotosService"
Cohesion: 0.31
Nodes (4): ContentPhotosService, labsFoodPhotoFolder(), service(), Injectable

### Community 83 - "main.ts"
Cohesion: 0.11
Nodes (24): shouldVerifyClerkJwt(), AllExceptionsFilter, Answer, answerFor(), BUSINESS_REFUSALS, AppLogger, isEvent(), JsonOptions (+16 more)

### Community 84 - "messaging.service.spec.ts"
Cohesion: 0.29
Nodes (8): Contact details masked when served, not when stored, CONTACT_MASK, detectContact(), maskContact(), matches(), conversation(), person(), supportConversation()

### Community 85 - "env-files.ts"
Cohesion: 0.27
Nodes (7): Env precedence: repo-root .env.local overrides shell exports, url, appsDir, args, findRepoRoot(), loadRepoEnv(), resolveEnvFilePaths()

### Community 86 - ".createCheckoutSession"
Cohesion: 0.22
Nodes (12): PaymentsController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse (+4 more)

### Community 87 - "profile.dto.ts"
Cohesion: 0.18
Nodes (17): CLIENT_STATUS_HELP, CLIENT_STATUSES, ApiPropertyOptional, IsArray, IsBoolean, IsIn, IsInt, IsOptional (+9 more)

### Community 88 - "db-connection.ts"
Cohesion: 0.15
Nodes (12): distrustCompromisedRoots(), TRUSTED_ROOT_CERTIFICATES, createPrismaClient(), PrismaClientBundle, PrismaLogLevel, isSupabaseCloudUrl(), PG_URL_TLS_PARAMS, postgresPoolConfig (+4 more)

### Community 89 - "BookingsService"
Cohesion: 0.29
Nodes (6): BookingsService, invalid(), notFound(), Injectable, Audience, acceptedConsents()

### Community 90 - "bookings.dto.ts"
Cohesion: 0.14
Nodes (33): AdminBookingsQueryDto, AdminUpdateBookingDto, BookingMealDto, BookingPhotoConfirmDto, BookingsQueryDto, ChefBookingsQueryDto, ChefUpdateBookingDto, ContractConsentsDto (+25 more)

### Community 93 - "4. Juridique"
Cohesion: 0.06
Nodes (33): 0. Le bilan en bref, 1. Les deux blocs, 2.1 Les courses (carte et empreinte), 2.2 La prestation et le forfait (avance immédiate), 2.3 Cas particuliers, 2. Le parcours, étape par étape, 3. Où passe l'argent, 4.10 Données personnelles (+25 more)

### Community 94 - "clerk-user-payload.ts"
Cohesion: 0.67
Nodes (5): clerkProfileFromBapiUser(), clerkProfileFromUserJson(), fullNameFromClerkUser(), primaryEmailFromClerkUser(), primaryPhoneFromClerkUser()

### Community 95 - "ReferentialsController"
Cohesion: 0.14
Nodes (13): Commune, detailOf(), isCommuneList(), isTimeout(), byLabel(), ReferentialsController, ApiOkResponse, ApiOperation (+5 more)

### Community 96 - "HealthController"
Cohesion: 0.24
Nodes (7): HealthController, ApiOkResponse, ApiOperation, ApiTags, Get, SkipThrottle, HealthCheck

### Community 97 - "StripeWebhooksService"
Cohesion: 0.14
Nodes (12): StripeWebhooksController, ApiExcludeController, ApiTags, HttpCode, Post, Req, SkipThrottle, StripeWebhooksModule (+4 more)

### Community 98 - "UpdateMeSapProfileDto"
Cohesion: 0.14
Nodes (14): SAP_DECLARATION_TYPES, SAP_EXTERNAL_STATUSES, SapProfileDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsIn, IsNotEmpty (+6 more)

### Community 99 - "jest"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 100 - "ChefProfileFieldsDto"
Cohesion: 0.17
Nodes (12): ChefProfileFieldsDto, ApiProperty, ApiPropertyOptional, ArrayUnique, IsArray, IsIn, IsInt, IsOptional (+4 more)

### Community 101 - "20260920120000_chef_onboarding/migration.sql"
Cohesion: 0.29
Nodes (5): Append-only chef_documents owned by the chef profile from first upload, Legacy tables renamed aside to *_legacy, not dropped, "audit_log", "chef_applications", "chef_documents"

### Community 103 - "tsconfig.build.json"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, tsBuildInfoFile, exclude, extends, include, ./tsconfig.json

### Community 104 - "countries.ts"
Cohesion: 0.32
Nodes (5): ALPHA2_TO_NUMERIC, COUNTRIES_TOTAL, country(), COUNTRY_CODES, frenchNames

### Community 105 - "contract-documents.ts"
Cohesion: 0.21
Nodes (29): ASSETS, brandDocument(), brandHeader(), COLOR, FONT, footer(), label, LOGO (+21 more)

### Community 106 - "build-run-push job"
Cohesion: 0.33
Nodes (5): Docker image workflow (GitHub Actions), build-run-push job, Publish image to GHCR on pushes and tags, never on PRs, Smoke test: migrate, boot, /health and /ready against a throwaway Postgres, docker-entrypoint.sh script

### Community 107 - "QuotesService"
Cohesion: 0.18
Nodes (6): QuoteView, Viewer, notFound(), QuotesService, Injectable, ChefIdentity

### Community 110 - "bookings.service.ts"
Cohesion: 0.09
Nodes (23): HHMM, PARIS, parisHhmm(), parisOffsetMs(), parisToday(), Caller, changedKeys(), HOLD_MS (+15 more)

### Community 112 - "commission-policy.ts"
Cohesion: 0.15
Nodes (16): EarningsInput, RATES, ACCEPTED_OFFER, commissionFor(), commissionForPayment(), CommissionPolicyDb, hasDeal(), OfferDeal (+8 more)

### Community 113 - "20260831120000_payments_sap_sepa_foundations/migration.sql"
Cohesion: 0.50
Nodes (3): "commissions", "sap_profiles", "sepa_mandates"

### Community 114 - ".ensurePersistedFromClerk"
Cohesion: 0.09
Nodes (21): AllergiesController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse, Delete (+13 more)

### Community 115 - "env.validation.ts"
Cohesion: 0.33
Nodes (5): CLERK_SECRET_KEY_PATTERN, envValidationSchema, REQUIRED, Add Brevo template workflow, joi

### Community 116 - "ApiBookingId"
Cohesion: 0.22
Nodes (19): MeBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+11 more)

### Community 117 - "redis.module.ts"
Cohesion: 0.50
Nodes (3): RedisModule, Global, Module

### Community 118 - "AuditModule"
Cohesion: 0.67
Nodes (3): AuditModule, Global, Module

### Community 119 - "IntegrationsModule"
Cohesion: 0.67
Nodes (3): IntegrationsModule, Global, Module

### Community 132 - "CreateQuoteDto"
Cohesion: 0.14
Nodes (28): TimeSlot, AcceptOfferDto, CreateQuoteDto, CreateQuoteOfferDto, DeclineDto, EditableQuoteFieldsDto, VALID, ApiProperty (+20 more)

### Community 133 - "QuoteOffersService"
Cohesion: 0.12
Nodes (10): isUniqueViolation(), offerNotFound(), QuoteOffersService, Cron, Injectable, SentryCron, LoadedQuote, day() (+2 more)

### Community 134 - "ApiClerkAuthResponses"
Cohesion: 0.21
Nodes (19): ApiClerkAuthResponses(), ChefBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+11 more)

### Community 135 - ".feed"
Cohesion: 0.10
Nodes (22): ChefCalendarFeedController, PublicCalendarFeedController, ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse (+14 more)

### Community 136 - "content.errors.ts"
Cohesion: 0.13
Nodes (23): aiFormatInvalid(), allergenConflict(), allergensUnverified(), allergiesNotDeclared(), healthConsentRequired(), limitReached(), menuFrozen(), shoppingByClient() (+15 more)

### Community 137 - ".outcome"
Cohesion: 0.17
Nodes (21): AdminUrssafController, BookingPaymentsController, requestId(), ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+13 more)

### Community 138 - "booking-reschedules.service.ts"
Cohesion: 0.15
Nodes (20): answeredMeanwhile(), Booking, BOOKING_SELECT, BookingReschedulesService, contactOf(), endFor(), nameOf(), notFound() (+12 more)

### Community 139 - ".addBlock"
Cohesion: 0.12
Nodes (19): AgendaService, Injectable, ChefAgendaController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse (+11 more)

### Community 140 - "availability.dto.ts"
Cohesion: 0.19
Nodes (26): AgendaQueryDto, AgendaSummaryQueryDto, AvailabilityExceptionDto, ChefSlotsQueryDto, PublicSlotsQueryDto, ScheduleDto, TimeBlockDto, ApiProperty (+18 more)

### Community 141 - "CommissionDebitsService"
Cohesion: 0.14
Nodes (5): addDays(), CommissionDebitsService, isUniqueViolation(), targetDate(), Injectable

### Community 142 - ".retryDebit"
Cohesion: 0.14
Nodes (21): CommissionInvoicesController, resolvePeriod(), toCommissionInvoiceDto(), ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+13 more)

### Community 143 - "class-transformer"
Cohesion: 0.18
Nodes (23): ApplicationAddressDto, ApplicationCompanyDto, ApplicationConsentDto, ApplicationIdentityDto, CompanySapDto, InterventionCityDto, InterventionZoneDto, ApiProperty (+15 more)

### Community 144 - "contact.dto.ts"
Cohesion: 0.11
Nodes (21): CONTACT_RATE_LIMIT, CONTACT_SOURCES, CONTACT_STATUSES, ContactSource, DEFAULT_CONTACT_SUBJECT, ListContactMessagesQueryDto, ReplyContactMessageDto, SETTABLE_CONTACT_STATUSES (+13 more)

### Community 145 - "booking-documents.service.ts"
Cohesion: 0.15
Nodes (16): stackOf(), addressOf(), BookingDocumentsService, chefNameOf(), CONTRACT_SELECT, ContractRow, Cron, Injectable (+8 more)

### Community 146 - "me-bookings.controller.ts"
Cohesion: 0.16
Nodes (17): ApiGeoResponses(), ICS_EXAMPLE, PHOTOS_EXAMPLE, ADMIN_CLIENT, ADMIN_DETAIL_EXAMPLE, ADMIN_ITEM_EXAMPLE, BATCH_COOKER_ONLY, BOOKING_DETAIL_EXAMPLE (+9 more)

### Community 147 - "quote.rules.ts"
Cohesion: 0.13
Nodes (19): AWAITING_CHEF, CLOSED, DUPLICATE_WINDOW_MS, MAX_NET_CENTS, MAX_OPEN_REQUESTS, MAX_VALIDITY_DAYS, MIN_NET_CENTS, MIN_VALIDITY_DAYS (+11 more)

### Community 148 - "Deploy LF-BackEnd on Railway"
Cohesion: 0.09
Nodes (23): 1. Create the service, 2. Environment variables, 3. Database URLs (Supabase), 4. Public domain & API URLs, 4b. Logs and debugging, 4c. Scheduled jobs, 5. Deploy flow, 6. Local Docker vs Railway (+15 more)

### Community 149 - ".sendTemplate"
Cohesion: 0.16
Nodes (5): amountOrEmpty(), BookingsMailer, euros(), firstName(), Injectable

### Community 150 - "BookingPaymentsService"
Cohesion: 0.16
Nodes (5): afterTaxCredit(), BookingPaymentsService, Injectable, advanceAccepted(), bookingCoverage

### Community 151 - "ListItemDto"
Cohesion: 0.15
Nodes (22): BookingSupplementsDto, ChefTierLabelsDto, ChefTiersDto, ListItemDto, RecipeProfilesDto, ReheatModesDto, ApiProperty, ArrayMaxSize (+14 more)

### Community 152 - ".update"
Cohesion: 0.16
Nodes (16): UpdateServiceOfferDto, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+8 more)

### Community 153 - "1. Site client (`batchcooking-web`)"
Cohesion: 0.09
Nodes (21): 0. Le contrat d'API à brancher, 1. Site client (`batchcooking-web`), 2. Console admin (`admin-dashboard`), 3. Après l'API du lot 6 : Budget Courses et empreinte (P2), 4. À faire hors front, 5. Recette, A1 — Les batch cookers (P1), A2 — Le détail d'une réservation (P0 pour la rétractation) (+13 more)

### Community 154 - ".create"
Cohesion: 0.17
Nodes (15): AdminBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags (+7 more)

### Community 155 - "Plan d'audit de sécurité — LF-BackEnd"
Cohesion: 0.10
Nodes (20): 0. Cadre & base de références, 1.1 Failles de logique métier (le risque n°1 ici), 1.2 Injections, 1. Stratégie de test — failles logiques & injections, 2. Simulation d'attaque — Top 3 cibles (pentest théorique), 3. Audit de configuration, 4. Audit de gestion des secrets, 5. Bilan de sécurité (synthèse noir / rouge / orange) (+12 more)

### Community 156 - "Evolution Register — Payments (Stripe CB, Connect, commissions, SAP/SEPA foundations)"
Cohesion: 0.10
Nodes (20): Change Log, Changed elsewhere, Configuration Evolution, Data model evolution, Documentation Evolution, Enums, Evolution Register — Payments (Stripe CB, Connect, commissions, SAP/SEPA foundations), File Evolution (+12 more)

### Community 157 - "booking-audiences.controller.spec.ts"
Cohesion: 0.13
Nodes (10): CalendarFeedService, FEED_IN_USE_MS, feedInUse(), hashOf(), BOOKING, FeedRow, STATUS_LABEL, Injectable (+2 more)

### Community 158 - "StatsService"
Cohesion: 0.18
Nodes (11): StatsController, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, Get, UseGuards, StatsModule (+3 more)

### Community 159 - "3. Endpoints"
Cohesion: 0.11
Nodes (19): 1. Model in one paragraph, 2. Prerequisites per role, 3. Endpoints, 4. Webhook — `POST /webhooks/stripe`, 5. Commission arithmetic, 6. Configuration, 7. Data model, 8. Known limitations (+11 more)

### Community 160 - "global-throttler.smoke.spec.ts"
Cohesion: 0.17
Nodes (9): GLOBAL_THROTTLER, GlobalThrottlerGuard, build(), Injectable, SmokeModule, Module, ipSeenBehind(), trustRailwayEdge() (+1 more)

### Community 161 - "CatalogService"
Cohesion: 0.17
Nodes (7): CatalogService, isNotFound(), isUniqueViolation(), menuWeekNotFound(), onMenu(), Injectable, weekTaken()

### Community 162 - "classification.rules.ts"
Cohesion: 0.14
Nodes (15): ALL_YEAR, CatalogEntry, ChefVersion, Classification, classify(), DECLARED_DIET_CODES, DECLARED_DIETS, linkedIds() (+7 more)

### Community 163 - "quote-offers.service.ts"
Cohesion: 0.19
Nodes (11): ACTIVE_OFFER, MAX_DAYS_AHEAD, NOW, OFFER, QuotesMailer, SLOT_LABEL, Injectable, closing() (+3 more)

### Community 164 - ".replace"
Cohesion: 0.19
Nodes (12): ChefAvailabilityController, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags (+4 more)

### Community 165 - "service-offers.service.ts"
Cohesion: 0.27
Nodes (12): bookingAmounts(), DEFAULT_SUPPLEMENT_RULES, reprice(), shoppingFee(), supplementRulesInForce(), Supplements, supplementsFor(), supplementsTotal() (+4 more)

### Community 166 - "PaymentsService"
Cohesion: 0.27
Nodes (7): CommissionBreakdown, CheckoutSessionDto, PaymentIntentDto, ApiProperty, setup(), PaymentsService, Injectable

### Community 167 - "chef-legal.views.ts"
Cohesion: 0.18
Nodes (12): CHEF_LEGAL_SELECT, CHEF_LEGAL_STATUSES, ChefLegalGap, chefLegalIdentity, ChefLegalRow, ChefLegalStatus, EMPTY, FULL (+4 more)

### Community 168 - "[1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02)"
Cohesion: 0.13
Nodes (14): [1.4.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.3.0...v1.4.0) (2026-10-31), [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02), [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02), [2.0.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.5.0...v2.0.0) (2026-11-09), ⚠ BREAKING CHANGES, Bug Fixes, Bug Fixes, Bug Fixes (+6 more)

### Community 169 - "/lf-security-audit"
Cohesion: 0.13
Nodes (14): Baseline connue (2026-10-20) — un run est un DIFF vs ceci, Checklist tests dynamiques (pour l'humain, env de test uniquement), Garde-fous (NON négociables), /lf-security-audit, Phase 0 — Cartographie (toujours), Phase 1 — Authentification & bootstrap  (⚫ Cible 1), Phase 2 — Autorisation objet/fonction  (🟠 Cible 2 — anti-régression), Phase 3 — Webhooks & secrets (+6 more)

### Community 170 - "contract-documents.spec.ts"
Cohesion: 0.19
Nodes (10): textOf(), cgvPath(), cgvPdf(), flat(), InvoiceLine, formatMoney(), PaymentInvoiceSnapshot, SNAPSHOT (+2 more)

### Community 171 - "WeekMenusQueryDto"
Cohesion: 0.18
Nodes (14): ChefShowcaseQueryDto, ApiPropertyOptional, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional (+6 more)

### Community 172 - "booking-payments.dto.ts"
Cohesion: 0.24
Nodes (13): DecideUrssafLinkDto, RequestUrssafLinkDto, SettleBookingDto, SimulateUrssafOutcomeDto, ApiProperty, ApiPropertyOptional, IsIn, IsOptional (+5 more)

### Community 173 - "fiscal-attestations.service.ts"
Cohesion: 0.15
Nodes (11): attestationExclusion(), AttestationPayment, ECESU_ATTESTATION_NOTE, isPlatformAttestable(), CHEF_A, CHEF_B, CHEF_UNDECLARED, CLIENT (+3 more)

### Community 174 - "Clerk identity + Supabase/Prisma app data"
Cohesion: 0.14
Nodes (14): 1. Clerk → Postgres (primary, ongoing), 2. Postgres → Clerk (migration / demo, one-off), 3. Request-time upsert (first sign-in), Admin provisioning (Backend API), Backfill for accounts the webhook never saw, Clerk identity + Supabase/Prisma app data, Code map, Dashboard / frontend contract (+6 more)

### Community 175 - "Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine"
Cohesion: 0.14
Nodes (14): CESU lifecycle, Configuration, Explicitly out of scope, File Evolution, Mixed CESU + card, Open before production, Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine, Routes added (+6 more)

### Community 176 - "ContactService"
Cohesion: 0.21
Nodes (5): Contact forms: stored first, emailed second, ContactService, firstNameOf(), notFound(), Injectable

### Community 177 - ".slots"
Cohesion: 0.15
Nodes (11): PublicAvailabilityController, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnprocessableEntityResponse, Get (+3 more)

### Community 178 - "admin-chefs.dto.ts"
Cohesion: 0.15
Nodes (11): METROPOLITAN_REGIONS, CHEF_SORTS, CHEF_STATE_FILTERS, CHEF_STATE_HELP, CHEF_STATES, ChefState, ChefStateFilter, REGION_CODES (+3 more)

### Community 179 - "admin-chefs.service.ts"
Cohesion: 0.19
Nodes (12): BookingCounts, CHEF_SELECT, ChefRow, CONTENT_COUNTS, LIVE_ACCOUNT, REGION_LABEL, stateOf(), StoredCity (+4 more)

### Community 180 - "F19 - Page "Notre Concept" CMS"
Cohesion: 0.15
Nodes (12): Acceptance Criteria, API Contract Draft, Current Codebase Finding, Data Model Proposal, Existing Files To Modify, F19 - Page "Notre Concept" CMS, Feature Source, `GET /content/concept` (+4 more)

### Community 181 - "CreateCheckoutSessionDto"
Cohesion: 0.17
Nodes (12): CreateCheckoutSessionDto, CreatePaymentIntentDto, FiscalAttestationProviderDto, ApiPropertyOptional, IsIn, IsInt, IsOptional, IsPositive (+4 more)

### Community 182 - "CreateServiceOfferDto"
Cohesion: 0.24
Nodes (12): CreateServiceOfferDto, OfferPriceQueryDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsInt, IsOptional, IsString (+4 more)

### Community 183 - "ServiceOffersService"
Cohesion: 0.32
Nodes (4): ServiceOffersService, Injectable, unprocessable(), view()

### Community 184 - "In-house batch cooker calendar"
Cohesion: 0.17
Nodes (12): Context, Cross-check against the batchcooking-web agenda, Decided (2026-10-15), For the front team (LF-0074 and what follows), Implementation notes (where the code differs from the text above), In-house batch cooker calendar, Migrations (written, never applied by me), Order and verification (+4 more)

### Community 185 - "Supabase Postgres connection (LF-BackEnd)"
Cohesion: 0.17
Nodes (12): Behavior in this repo, Env file location, Environment variables, Partially applied migrations, Prisma baseline (existing TypeORM databases), Prisma commands (ORM 7), Railway production, Supabase Postgres connection (LF-BackEnd) (+4 more)

### Community 186 - "Controller"
Cohesion: 0.25
Nodes (7): Controller, AdminServiceOffersController, PublicServiceOffersController, ServiceOffersController, ApiBearerAuth, ApiTags, UseGuards

### Community 187 - "ics.ts"
Cohesion: 0.33
Nodes (7): where(), icsCalendar(), IcsEvent, icsFold(), icsText(), icsUtc(), RFC-5545

### Community 188 - "ConfirmUploadDto"
Cohesion: 0.29
Nodes (11): ConfirmUploadDto, CreateUploadUrlDto, DecideDocumentDto, ApiProperty, ApiPropertyOptional, IsDateString, IsIn, IsInt (+3 more)

### Community 189 - "payment-invoices.rules.ts"
Cohesion: 0.38
Nodes (7): formatInvoiceNumber(), InvoiceBookingFacts, invoiceLines(), invoiceNumberPrefix(), invoiceYear(), parseTemplate(), BOOKING

### Community 190 - "AdminChefsService"
Cohesion: 0.33
Nodes (4): Batch cookers in the back office (LF-0164, GET /admin/chefs), AdminChefsService, STATE_WHERE, Injectable

### Community 191 - "UrssafGateway"
Cohesion: 0.22
Nodes (5): UrssafGatewayMode, Injectable, UrssafGateway, UrssafPaymentRequest, UrssafTransmission

### Community 192 - "quote.views.ts"
Cohesion: 0.31
Nodes (8): AssignedChef, dateOnly(), LoadedOffer, QUOTE_INCLUDE, offer(), quote(), toOfferView(), toQuoteView()

### Community 193 - "UpdateChefLegalDto"
Cohesion: 0.20
Nodes (10): ChefLegalDto, ApiProperty, ApiPropertyOptional, IsIn, IsOptional, IsString, IsUrl, Length (+2 more)

### Community 194 - "Role-segmented bookings, batch cooker availability and Cronofy"
Cohesion: 0.20
Nodes (8): Assumptions to confirm, Context, Files, Implementation notes (where the code differs from this plan), Migrations (written only, never applied by me), Role-segmented bookings, batch cooker availability and Cronofy, Status, Verification

### Community 195 - "catalog.module.ts"
Cohesion: 0.25
Nodes (7): AuthModule, Global, Module, CatalogModule, Module, DishesModule, Module

### Community 196 - "recipe-document.ts"
Cohesion: 0.25
Nodes (7): labelOf(), number, RecipeDocumentInput, INPUT, STORAGE_METHODS, Stored, watermark()

### Community 197 - "CreateAdminUserDto"
Cohesion: 0.25
Nodes (9): CreateAdminUserDto, ApiProperty, ApiPropertyOptional, IsEmail, IsIn, IsOptional, IsString, UpdateUserRoleDto (+1 more)

### Community 198 - "overrides"
Cohesion: 0.25
Nodes (8): glob, js-yaml, overrides, fastify, @nestjs/cli, @nestjs/swagger, @typescript-eslint/typescript-estree, minimatch

### Community 199 - "swagger.ts"
Cohesion: 0.39
Nodes (6): TAG_DESCRIPTIONS, buildOpenApiDocument(), GUIDE, schemaOf(), Paths, withSchemasFromExamples()

### Community 200 - "client-onboarding.rules.ts"
Cohesion: 0.32
Nodes (6): clientOnboarding(), ClientOnboardingFacts, ClientOnboardingStep, filled(), DONE, NOTHING

### Community 201 - "templates.test.mjs"
Cohesion: 0.25
Nodes (5): Brevo template security rules, declared(), FIXTURES, RULES, SIGN_IN_EMAILS

### Community 202 - "Phase C: Cronofy (connect, free/busy, events), data center `de`"
Cohesion: 0.25
Nodes (8): API client: `src/integrations/cronofy.service.ts`, Booking integration, Calendar module: `src/modules/calendar/`, Config and fix, Frontend dependency (batchcooking-web; NEVER touch it unless you ask), Phase C: Cronofy (connect, free/busy, events), data center `de`, Prisma, Token encryption: `src/common/crypto/secret-box.ts`

### Community 203 - "Phase D1: the agenda, fitted to the page"
Cohesion: 0.25
Nodes (8): Closed days stop requests, not counter-proposals, Errors, Logs, Phase D1: the agenda, fitted to the page, Routes (tag `chefBookings`, `ClerkAuthGuard`, approved batch cooker), Schema (migration `20261015120000_agenda`), Tests, Working hours (`/chef/availability`), fitted to how the page edits

### Community 204 - "Rapport d'audit sécurité — LF-BackEnd — 2026-10-24 (run `--quick`)"
Cohesion: 0.25
Nodes (7): Bilan ⚫🔴🟠 (inchangé), Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici, Contrôles de régression Phase 0/2 (routes nouvelles ou modifiées depuis `b370f11`), Hors cibles, vus dans le diff (🟢, ne pas casser), Rapport d'audit sécurité — LF-BackEnd — 2026-10-24 (run `--quick`), Résultat : ✅ 0 régression — les 3 cibles sont INCHANGÉES (toujours ouvertes), ⚠️ À vérifier côté opérations (hors code)

### Community 205 - "ListAdminChefsQueryDto"
Cohesion: 0.29
Nodes (7): ListAdminChefsQueryDto, ApiPropertyOptional, IsIn, IsOptional, IsString, MaxLength, Transform

### Community 206 - "chef-profile.dto.ts"
Cohesion: 0.29
Nodes (4): ISO_639_1, LANGUAGE_CODES, languageNames, LANGUAGES

### Community 207 - "Phase A: role-segmented bookings"
Cohesion: 0.29
Nodes (7): Controllers, e-CESU proof of payment (payments module), Phase A: role-segmented bookings, Routes, Service: `bookings.service.ts`, Status rules: `bookings/domain/booking-status.ts`, Views, DTOs and other Phase A edits

### Community 208 - "Phase B: working hours and computed availability (no Cronofy needed)"
Cohesion: 0.29
Nodes (7): Domain, How long a pending booking holds its slot: `BookingsService.expireUnpaid`, Not included, Phase B: working hours and computed availability (no Cronofy needed), Prisma, Routes, Service: `calendar/availability.service.ts`

### Community 209 - "Phase L: error handling and logging, for every phase below"
Cohesion: 0.29
Nodes (7): L1. Request context, L2. One logger, structured, L3. One exception filter, L4. Rules every phase follows, L5. Shipping logs (not built now), L6. Retrofitting Phases A and B, Phase L: error handling and logging, for every phase below

### Community 210 - "booking-reschedules.service.spec.ts"
Cohesion: 0.53
Nodes (4): booking(), hoursAhead(), NOW, proposal()

### Community 211 - "Phase S: a temporary `disputed` status"
Cohesion: 0.33
Nodes (6): Code, Errors and logs, Phase S: a temporary `disputed` status, Rules, Tests, Why "temporary" stays in the database

### Community 212 - "Rapport d'audit sécurité — LF-BackEnd — 2026-10-20 (run `--quick`)"
Cohesion: 0.33
Nodes (5): Bilan ⚫🔴🟠 (inchangé), Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici, Contrôles de régression Phase 0/2, Rapport d'audit sécurité — LF-BackEnd — 2026-10-20 (run `--quick`), Résultat : ✅ 0 régression — état courant = baseline

### Community 213 - "20260905120000_payments_cesu_commission_debits/migration.sql"
Cohesion: 0.40
Nodes (4): "cesu_settlements", "commission_debits", "commission_invoices", "stripe_event_logs"

### Community 214 - "RoutesController"
Cohesion: 0.50
Nodes (3): RoutesController, Get, SkipThrottle

### Community 215 - "Phase D1b: what clients see"
Cohesion: 0.40
Nodes (5): Errors and logs, Phase D1b: what clients see, Public availability without an offer id, `slotsLeft` from the agenda (FLOW-02 §5.1), Tests

### Community 216 - "20261014130000_chef_availability/migration.sql"
Cohesion: 0.67
Nodes (3): "chef_availability_exceptions", "chef_working_hours", "chef_profiles"

### Community 217 - "ListAdminClientsQueryDto"
Cohesion: 0.50
Nodes (4): ListAdminClientsQueryDto, ApiPropertyOptional, IsEnum, IsOptional

## Ambiguous Edges - Review These
- `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` → `labsfood-web service (port 3007)`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to
- `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)` → `In-house messaging module`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to

## Knowledge Gaps
- **897 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `tsConfigPath` (+892 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1623 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` and `labsfood-web service (port 3007)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)` and `In-house messaging module`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `@nestjs/common` connect `@nestjs/common` to `UsersService`, `CurrentClerkUser`, `ApiAdminAuthResponses`, `chef-onboarding.rules.ts`, `content.errors.ts`, `moderation.service.ts`, `booking-reschedules.service.ts`, `vitrine.service.ts`, `suggestions.service.ts`, `messaging.gateway.ts`, `booking-documents.service.ts`, `me-bookings.controller.ts`, `package.json`, `dishes.test-helpers.ts`, `admin-conversations.controller.ts`, `dishes.service.ts`, `booking-withdrawals.service.ts`, `R2StorageService`, `ClerkUser`, `booking-audiences.controller.spec.ts`, `StatsService`, `global-throttler.smoke.spec.ts`, `PrismaService`, `quote-offers.service.ts`, `menus.service.ts`, `KycStorageService`, `service-offers.service.ts`, `allowed-origins.ts`, `messaging.service.ts`, `fiscal-attestations.service.ts`, `availability.service.ts`, `contact.service.ts`, `chef-applications.service.ts`, `app.module.ts`, `admin-chefs.service.ts`, `dishes.rules.ts`, `class-validator`, `chef-documents.controller.ts`, `payment-invoices.rules.ts`, `public-users.controller.ts`, `cesu-payments.service.ts`, `UrssafGateway`, `clerk-webhooks.controller.ts`, `catalog.module.ts`, `sepa-mandates.controller.ts`, `withdrawal.rules.ts`, `swagger.ts`, `platform-settings.service.ts`, `recipes.rules.ts`, `allergies.rules.ts`, `booking-reschedules.service.spec.ts`, `main.ts`, `messaging.service.spec.ts`, `StripeWebhooksService`, `bookings.service.ts`, `redis.module.ts`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `ClerkUser` connect `ClerkUser` to `.reply`, `CurrentClerkUser`, `ApiAdminAuthResponses`, `.reapply`, `ApiClerkAuthResponses`, `.feed`, `MeContentController`, `moderation.service.ts`, `.outcome`, `.addBlock`, `.setZones`, `.chefIdentity`, `.retryDebit`, `me-bookings.controller.ts`, `Body`, `.updateMeal`, `AdminContentController`, `admin-conversations.controller.ts`, `.update`, `.create`, `R2StorageService`, `AdminConversationsController`, `Query`, `StatsService`, `.decideDocument`, `.replace`, `.submit`, `.confirm`, `chef-documents.controller.ts`, `PaymentInvoicesService`, `sepa-mandates.controller.ts`, `.deleteUser`, `platform-settings.service.ts`, `CesuPaymentsService`, `.createCheckoutSession`, `.ensurePersistedFromClerk`, `ApiBookingId`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `AGENTS.md (development and architecture instructions)` connect `AGENTS.md (development and architecture instructions)` to `Analysis: one account, two spaces (client and chef switcher)`, `20260920120000_chef_onboarding/migration.sql`, `messaging.service.ts`, `.chef`, `stack.md`, `ContactService`, `messaging.service.spec.ts`, `env-files.ts`, `AdminChefsService`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _897 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UsersService` be split into smaller, more focused modules?**
  _Cohesion score 0.038623823433950016 - nodes in this community are weakly interconnected._