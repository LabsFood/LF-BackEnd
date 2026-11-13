# Graph Report - LF-BackEnd  (2026-11-12)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 4625 nodes · 13410 edges · 183 communities (175 shown, 6 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 865 edges (avg confidence: 0.81)
- Token cost: 260,877 input · 20,377 output

## Graph Freshness
- Built from commit: `303fef74`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Users & Stats Services
- Contact Messages Controller
- Quotes Controllers
- Clerk Auth Guards
- User Response DTOs
- Chef Applications Controller
- Admin Chefs Controller
- Audit & Chef Onboarding Rules
- Client Content Controller
- Admin Content Moderation
- Storefront (Vitrine) Rules
- Chef Content Service
- Admin Content & Labs Food DTOs
- Dish Suggestions Service
- Catalog Ingredients DTOs
- Menu DTOs
- Messaging WebSocket Gateway
- Backend Spec Documentation
- Swagger API Decorators
- Package Metadata Config
- Dishes Test Helpers
- KYC Document Storage & CESU DTOs
- Admin Bookings Controller
- Messaging DTOs
- Catalog Service (Meals/Menus)
- Pagination Utilities
- Messaging Service
- R2 Photo Storage Service
- Client Conversations Controller
- Admin Conversations Controller
- Fiscal Attestations Controller
- Chef Onboarding Emails
- Chef Applications Admin Controller
- Core Shared Services
- Brevo Template Upload Sync
- Package Dependencies
- Chef Content Service & Errors
- Supabase Storage Service
- Chef Documents Service
- Avatar Controller
- Demo Seed Constants
- CORS Configuration
- Messaging Rules & Contact Release
- Docker Compose Local Dev Stack
- NPM Scripts & DB Tooling
- Missions Controller
- Availability Service
- Brevo Email Service
- Geo Service & Commune Rules
- devDependencies
- App Module Wiring
- TypeScript Config
- Clerk Integration Contract Doc
- Chef Documents Controller
- Dish Views & Classification Rules
- Chef Application DTOs
- CESU Payments Service
- Messaging Admin Service
- Meal/Menu Week DTOs
- Chef Onboarding Swagger Examples
- Catalog/Dish DTOs & Enums
- Branded PDF Document Styling
- User Registration API
- Booking Payments (URSSAF/CESU)
- Stripe Service & Commission Invoicing
- Clerk Webhooks Controller
- Dual-Role Account & Self-Dealing Guard
- Stripe Connect SEPA DTOs
- SEPA Mandates Service
- Chef Applications Admin Service
- Missions & Shopping Lists
- Booking Withdrawal & Contract Rules
- Account Deletion Controller
- Chef Tiers & Platform Settings
- Architecture & Dev Docs
- Clerk-to-DB Sync Script
- Users-to-Clerk Sync Script
- Recipe Rules & Shopping Aggregation
- Mission DTOs
- NestJS CLI Config
- Allergy Rules & Service
- CESU Payments Controller
- Content Photos Service
- App Logging & Sentry
- Contact Info Masking
- Env File Loader
- Payment Intent DTOs
- Admin Client DTOs
- Prisma Database Connection
- Bookings Service Core
- Bookings DTOs & Photos
- Stripe Connect Controller
- Catalog Moderation
- Budget Courses Analysis Doc
- Clerk User Payload Helpers
- Referentials API
- Health Check API
- Public Chef Showcase API
- SAP Declaration DTO
- Jest Config
- Chef Profile Fields DTO
- Notifications API
- Messaging Rate Limit & Storage
- TypeScript Build Config
- Demo Seed Script
- Clerk Webhooks Service
- Docker Build & Deploy Workflow
- Quotes Service
- User Role Enum
- unseed-demo.ts
- Paris Time Utils & Agenda
- all-exceptions.filter.ts
- Commission Calculation
- Referentials Constants
- Allergies Controller
- Env Validation Schema
- Client Bookings Controller
- Chef Verification DTO
- Webhook Raw Body & Request Context
- Pre-commit Hook
- Feature Request Template
- Quote DTOs
- Quote Offers Service
- Chef Bookings Controller
- Calendar Feed Controllers
- Shopping List & Countries
- URSSAF & Booking Payments Controllers
- Booking Reschedules Service
- Chef Agenda Service & Controller
- Availability DTOs
- Commission Debits Service
- Commission Invoices Controller
- Chef Application DTOs
- Contact Service & DTOs
- Booking Documents Service
- Quote Business Rules
- Railway Deployment Guide Doc
- Booking Email Notifications
- Booking Payments Service
- Platform Settings DTOs
- Service Offer DTOs
- CGV V1 Front Plan Doc
- Security Audit Plan Doc
- Payments Evolution Register Doc
- Stats Dashboard API
- Chef Payments & Stripe Onboarding Docs
- Rate Throttling Guard
- Quote Email Notifications
- Chef Availability API
- Chef Legal Identity Views
- Changelog History
- Security Audit Skill Docs
- Chef Showcase Query DTO
- Booking Payments API
- Fiscal Attestations Service
- Clerk-Postgres Identity Sync Docs
- Contact Form Service
- Public Availability API
- Admin Chef Listing DTO
- Admin Chefs Service
- Concept Page CMS Spec
- In-House Calendar Migration Plan
- Database & Env Setup Docs
- Document Upload DTOs
- URSSAF Config & Gateway
- Bookings/Calendar Planning Docs
- Admin User Role DTO
- Package Dependencies
- Brevo Template Security Tests
- Cronofy Calendar Integration
- Chef Agenda & Working Hours Plan
- Security Audit Report Oct24
- Chef Profile Languages
- Role-Segmented Bookings Plan
- Working Hours Availability Plan
- Error Handling & Logging Plan
- Disputed Status Phase Plan
- Security Audit Report Oct20
- Public Availability Display Plan
- Admin Clients Query DTO
- Commit Message Hook

## God Nodes (most connected - your core abstractions)
1. `ClerkUser` - 247 edges
2. `CurrentClerkUser` - 239 edges
3. `ApiClerkAuthResponses()` - 187 edges
4. `@nestjs/common` - 163 edges
5. `ApiAdminAuthResponses()` - 131 edges
6. `UsersService` - 121 edges
7. `PrismaService` - 113 edges
8. `@nestjs/swagger` - 89 edges
9. `AuditService` - 57 edges
10. `ClerkAuthGuard` - 43 edges

## Surprising Connections (you probably didn't know these)
- `Append-only chef_documents owned by the chef profile from first upload` --references--> `ChefDocumentsService`  [INFERRED]
  AGENTS.md → apps/src/modules/chef-onboarding/services/chef-documents.service.ts
- `Contact forms: stored first, emailed second` --references--> `ContactService`  [INFERRED]
  AGENTS.md → apps/src/modules/contact/contact.service.ts
- `client / chef / admin roles` --references--> `AdminGuard`  [EXTRACTED]
  stack.md → apps/src/auth/admin.guard.ts
- `Auth testing without Clerk (sk_test_placeholder decodes JWT without JWKS)` --references--> `ClerkAuthGuard`  [EXTRACTED]
  AGENTS.md → apps/src/auth/clerk-auth.guard.ts
- `Automatic-suspension episode (chef_profiles.auto_suspended_at)` --references--> `ChefDossierCron`  [INFERRED]
  AGENTS.md → apps/src/modules/chef-onboarding/services/chef-dossier.cron.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Brevo template sync pipeline** — brevo_readme, brevo_layout, brevo_templates, brevo_upload, brevo_templates_test, brevo_upload_test, brevo_readme_upload_drift_detection [EXTRACTED 1.00]
- **KYC document expiry and suspension flow** — brevo_templates_brevo_tpl_document_expiring, brevo_templates_brevo_tpl_chef_suspended, brevo_templates_brevo_tpl_document_rejected, stack_supabase_storage [INFERRED 0.75]
- **Chef application lifecycle emails** — brevo_templates_brevo_tpl_application_received, brevo_templates_brevo_tpl_application_received_admin, brevo_templates_brevo_tpl_changes_requested, brevo_templates_brevo_tpl_document_rejected, brevo_templates_brevo_tpl_application_approved, brevo_templates_brevo_tpl_application_rejected, brevo_templates_brevo_tpl_sign_in_link, apps_src_modules_chef_onboarding_services_chef_onboarding_mailer_chefonboardingmailer [INFERRED 0.85]

## Communities (183 total, 6 thin omitted)

### Community 0 - "Users & Stats Services"
Cohesion: 0.06
Nodes (14): ClerkProfileFields, AllergiesService, Injectable, StatsService, Injectable, CreateUserDto, ApiProperty, IsEmail (+6 more)

### Community 1 - "Contact Messages Controller"
Cohesion: 0.13
Nodes (22): AdminContactController, ApiMessageIdParam(), ContactController, reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse (+14 more)

### Community 2 - "Quotes Controllers"
Cohesion: 0.17
Nodes (28): ClerkUser, AdminQuotesController, ApiOfferIdParam(), ApiQuoteIdParam(), ChefQuotesController, QuotesController, reqId(), ApiBearerAuth (+20 more)

### Community 3 - "Clerk Auth Guards"
Cohesion: 0.06
Nodes (52): AdminGuard, Injectable, assertClerkConfigured(), ClerkAuthGuard, decodeUnverifiedJwt(), JwtClaims, resolveClaims(), resolveClerkUser() (+44 more)

### Community 4 - "User Response DTOs"
Cohesion: 0.21
Nodes (20): DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PaginationMetaDto, ApiProperty, RegisterResponseDto, ApiProperty, AdminClientDto, AdminClientListItemDto (+12 more)

### Community 5 - "Chef Applications Controller"
Cohesion: 0.10
Nodes (26): ChefApplicationsController, MyChefApplicationController, reqId(), ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse (+18 more)

### Community 6 - "Admin Chefs Controller"
Cohesion: 0.16
Nodes (17): AdminChefsController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+9 more)

### Community 7 - "Audit & Chef Onboarding Rules"
Cohesion: 0.09
Nodes (36): AuditActorType, AuditEntry, ApplicationAnswers, AWAITING_DECISION, buildApplicationReference(), COUNTS_AS_VALID, deriveDossierStatus(), DOCUMENT_FAMILY (+28 more)

### Community 8 - "Client Content Controller"
Cohesion: 0.19
Nodes (28): ApiClerkAuthResponses(), ApiDishIdParam(), ApiMenuIdParam(), MeContentController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse (+20 more)

### Community 9 - "Admin Content Moderation"
Cohesion: 0.09
Nodes (36): AdminModerationController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags (+28 more)

### Community 10 - "Storefront (Vitrine) Rules"
Cohesion: 0.17
Nodes (21): coveredDiets(), coversArea(), InterventionZone, parisClock, parisDay(), parisMidnight(), rotationKey(), vitrineOrder() (+13 more)

### Community 11 - "Chef Content Service"
Cohesion: 0.11
Nodes (16): ChefContentService, Injectable, changedMeanwhile(), DishesService, goneMeanwhile(), Injectable, toDishView(), toModeration() (+8 more)

### Community 12 - "Admin Content & Labs Food DTOs"
Cohesion: 0.07
Nodes (44): LABS_FOOD_MENU_EXAMPLE, NOT_LABS_FOOD, ADMIN_DISH, CHEF, QUEUE_EXAMPLE, REASON_REQUIRED, SUSPENDED_DISH, ConsentDto (+36 more)

### Community 13 - "Dish Suggestions Service"
Cohesion: 0.23
Nodes (9): assertConsent(), copyDish(), dishesOf(), retryOnConflict(), SUGGESTION, SuggestionsService, toPreview(), Injectable (+1 more)

### Community 14 - "Catalog Ingredients DTOs"
Cohesion: 0.06
Nodes (50): seasonReview(), AdoptIngredientDto, CatalogIngredientDto, ListCatalogIngredientsQueryDto, SearchIngredientsQueryDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+42 more)

### Community 15 - "Menu DTOs"
Cohesion: 0.11
Nodes (23): CreateMenuDto, MENU_PERIODS, PutShowcaseWeeksDto, ShowcaseAssignmentDto, ShowcaseRangeQueryDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+15 more)

### Community 16 - "Messaging WebSocket Gateway"
Cohesion: 0.07
Nodes (19): MessagingGateway, SocketState, RealtimeEnvelope, RealtimeEvent, Listener, MessagingEventsService, Injectable, RedisModule (+11 more)

### Community 17 - "Backend Spec Documentation"
Cohesion: 0.11
Nodes (19): Admin backlog (SPEC-ADMIN-DASHBOARD), API surface summary, Authentication, Backend architecture, Booking lifecycle, Client / public backlog (SPEC-BACKEND), Current module layout (implemented), Data model direction (+11 more)

### Community 18 - "Swagger API Decorators"
Cohesion: 0.17
Nodes (21): ApiExtraModels, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+13 more)

### Community 19 - "Package Metadata Config"
Cohesion: 0.05
Nodes (41): author, commitlint, extends, description, keywords, license, lint-staged, {src,test}/**/*.ts (+33 more)

### Community 20 - "Dishes Test Helpers"
Cohesion: 0.29
Nodes (8): adminRow(), CHEF, dishRow(), harness(), menuRow(), readyDishRow(), UNMODERATED, WriteArgs

### Community 21 - "KYC Document Storage & CESU DTOs"
Cohesion: 0.11
Nodes (28): DOCUMENT_TYPES, ALLOWED_MIME_TYPES, DOWNLOAD_URL_TTL_SECONDS, MAX_FILE_BYTES, SignedUpload, BookingPaymentStatusDto, CESU_DECLARABLE_MEDIUMS, CESU_MEDIUMS (+20 more)

### Community 22 - "Admin Bookings Controller"
Cohesion: 0.05
Nodes (73): ApiAdminAuthResponses(), AdminBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+65 more)

### Community 23 - "Messaging DTOs"
Cohesion: 0.10
Nodes (34): AdminListConversationsQueryDto, AttachmentRefDto, CreateAttachmentUploadDto, ListMessagesQueryDto, OpenConversationDto, OpenSupportConversationDto, SendMessageDto, ApiProperty (+26 more)

### Community 24 - "Catalog Service (Meals/Menus)"
Cohesion: 0.09
Nodes (42): assertPublishable(), CatalogService, declarationOf(), isDeclared(), isNotFound(), isUniqueViolation(), LABS_FOOD, menuWeekNotFound() (+34 more)

### Community 25 - "Pagination Utilities"
Cohesion: 0.14
Nodes (14): buildPaginationMeta(), PageBounds, Paginated, PaginationQueryDto, resolvePageBounds(), ApiPropertyOptional, IsInt, IsOptional (+6 more)

### Community 26 - "Messaging Service"
Cohesion: 0.16
Nodes (7): PairBooking, ConversationDetailView, MessageView, isUniqueViolation(), MessagingService, toMessageView(), Injectable

### Community 27 - "R2 Photo Storage Service"
Cohesion: 0.08
Nodes (16): detectImageType(), MAX_PHOTO_BYTES, PHOTO_TYPES, photoKey(), R2Config, R2StorageService, Injectable, BookingPhotosService (+8 more)

### Community 28 - "Client Conversations Controller"
Cohesion: 0.17
Nodes (22): CurrentClerkUser, ApiConversationIdParam(), MeConversationsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse (+14 more)

### Community 29 - "Admin Conversations Controller"
Cohesion: 0.18
Nodes (21): AdminConversationsController, ApiConversationIdParam(), reqId(), ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse (+13 more)

### Community 30 - "Fiscal Attestations Controller"
Cohesion: 0.15
Nodes (17): FiscalAttestationDto, FiscalAttestationsController, resolveYear(), ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+9 more)

### Community 31 - "Chef Onboarding Emails"
Cohesion: 0.13
Nodes (19): ChefOnboardingMailer, Injectable, Brevo shared email layout, params: line contract, signInUrl invariant, Application approved email (BREVO_TPL_APPLICATION_APPROVED), Application received email (BREVO_TPL_APPLICATION_RECEIVED), Application received admin email (BREVO_TPL_APPLICATION_RECEIVED_ADMIN) (+11 more)

### Community 32 - "Chef Applications Admin Controller"
Cohesion: 0.19
Nodes (22): ApiApplicationIdParam(), ChefApplicationsAdminController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse (+14 more)

### Community 33 - "Core Shared Services"
Cohesion: 0.09
Nodes (10): AuditService, Injectable, ClerkService, Injectable, DishesMailer, Injectable, NotificationsService, Injectable (+2 more)

### Community 34 - "Brevo Template Upload Sync"
Cohesion: 0.15
Nodes (12): Upload digest drift detection, dir, layout, templates, byName, [check, update, force], compare(), digest() (+4 more)

### Community 35 - "Package Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, class-transformer, class-validator, @clerk/backend, @fastify/helmet, @fastify/static (+23 more)

### Community 36 - "Chef Content Service & Errors"
Cohesion: 0.14
Nodes (17): isDisabledByAdmin(), ChefContext, MENU_DISHES, MenuWithDishes, chefPhotoFolder(), plural(), offerPending(), validationFailed() (+9 more)

### Community 37 - "Supabase Storage Service"
Cohesion: 0.11
Nodes (7): LEGACY_KEY_VARS, SupabaseService, Injectable, KycStorageService, Injectable, proofPrefix(), @supabase/supabase-js

### Community 38 - "Chef Documents Service"
Cohesion: 0.13
Nodes (8): Automatic-suspension episode (chef_profiles.auto_suspended_at), expiryNoticeThreshold(), ChefDocumentsService, Injectable, ChefDossierCron, Cron, Injectable, SentryCron

### Community 39 - "Avatar Controller"
Cohesion: 0.15
Nodes (17): AvatarController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+9 more)

### Community 40 - "Demo Seed Constants"
Cohesion: 0.18
Nodes (16): DEMO_EMAIL_DOMAIN, DEMO_INVOICE_PREFIX, DEMO_STRIPE_EVENT_PREFIX, demoChargeId(), demoCommissionInvoiceNumber(), demoCrcesuNan(), demoDebitIntentId(), demoNovaCode() (+8 more)

### Community 41 - "CORS Configuration"
Cohesion: 0.27
Nodes (9): CORS_METHODS, corsOptions(), DEVELOPMENT_ORIGINS, isOriginAllowed(), normalize(), PRODUCTION_ORIGINS, resolveAllowedOrigins(), assertOwnSiteUrl() (+1 more)

### Community 42 - "Messaging Rules & Contact Release"
Cohesion: 0.08
Nodes (41): J-2 contact release (48h before a confirmed booking), CONTACT_RELEASE_HOURS, currentBooking(), DEFAULT_MESSAGE_PAGE_SIZE, isContactReleased(), isWritable(), MAX_ATTACHMENTS_PER_MESSAGE, MAX_BODY_LENGTH (+33 more)

### Community 43 - "Docker Compose Local Dev Stack"
Cohesion: 0.13
Nodes (25): api service (apps/Dockerfile, port 8000), postgres service (postgres:16-alpine), redis service (redis:7-alpine), local-dev full-stack docker-compose.yml, admin-dashboard service (port 8035), local-dev api service, batchcooking-web service (port 3005), labsfood-web service (port 3007) (+17 more)

### Community 44 - "NPM Scripts & DB Tooling"
Cohesion: 0.08
Nodes (26): scripts, build, db:backfill:clerk, db:backfill:clerk:dry, db:generate, db:migrate, db:migrate:dev, db:resolve (+18 more)

### Community 45 - "Missions Controller"
Cohesion: 0.23
Nodes (20): ApiMissionIdParam(), MissionsController, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+12 more)

### Community 46 - "Availability Service"
Cohesion: 0.14
Nodes (21): parisToday(), ymd(), assertValidSchedule(), AvailabilityService, Db, invalid(), readSchedule(), toExceptionView() (+13 more)

### Community 47 - "Brevo Email Service"
Cohesion: 0.10
Nodes (12): BrevoService, ChefOnboardingEmail, Injectable, shortName(), Claimed, MessagingNotifierCron, Cron, Injectable (+4 more)

### Community 48 - "Geo Service & Commune Rules"
Cohesion: 0.14
Nodes (14): Commune, communeKey(), matchCommune(), detailOf(), FAILED, GeoFailure, GeoService, isCommuneList() (+6 more)

### Community 49 - "devDependencies"
Cohesion: 0.07
Nodes (28): devDependencies, @commitlint/cli, @commitlint/config-conventional, eslint, eslint-config-prettier, eslint-plugin-prettier, husky, jest (+20 more)

### Community 50 - "App Module Wiring"
Cohesion: 0.06
Nodes (52): AuthModule, Global, Module, AuditModule, Global, Module, GLOBAL_THROTTLER, AllergiesModule (+44 more)

### Community 51 - "TypeScript Config"
Cohesion: 0.08
Nodes (24): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+16 more)

### Community 52 - "Clerk Integration Contract Doc"
Cohesion: 0.09
Nodes (23): A. Sign-up → DB sync (simulates frontend), Admin user provisioning, B. Sign-in → protected API, BAPI email verification note, C. Bootstrap first admin, Chef vetting, Clerk integration contract (frontend ↔ backend), Code map (+15 more)

### Community 53 - "Chef Documents Controller"
Cohesion: 0.18
Nodes (19): ChefDocumentsController, reqId(), ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+11 more)

### Community 54 - "Dish Views & Classification Rules"
Cohesion: 0.10
Nodes (32): computed(), seasonsOf(), toDishSummary(), toPublicDish(), ALL_YEAR, CatalogEntry, ChefVersion, Classification (+24 more)

### Community 55 - "Chef Application DTOs"
Cohesion: 0.24
Nodes (14): ApproveApplicationDto, ListChefApplicationsQueryDto, RejectApplicationDto, RequestChangesDto, ApiProperty, ApiPropertyOptional, ArrayMinSize, IsArray (+6 more)

### Community 56 - "CESU Payments Service"
Cohesion: 0.22
Nodes (4): CesuPaymentsService, toCesuPaymentDto(), Injectable, CesuPaymentDto

### Community 57 - "Messaging Admin Service"
Cohesion: 0.16
Nodes (7): AdminConversationView, AdminMessageView, MessagePage, MessagingAdminService, Injectable, LoadedConversation, notFound()

### Community 58 - "Meal/Menu Week DTOs"
Cohesion: 0.12
Nodes (23): CreateMealDto, CreateMenuWeekDto, MealResponseDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize, IsArray, IsBoolean (+15 more)

### Community 59 - "Chef Onboarding Swagger Examples"
Cohesion: 0.16
Nodes (18): VALIDATION_FAILED, ANSWERS_EXAMPLE, APPLICATION_DETAIL_EXAMPLE, APPROVED_EXAMPLE, CANDIDATURE_EXAMPLE, DECISION_EXAMPLE, DEPOSIT_EXAMPLE, DOCUMENT_STATUS_HELP (+10 more)

### Community 60 - "Catalog/Dish DTOs & Enums"
Cohesion: 0.14
Nodes (33): CONTINENTS, DIFFICULTIES, MEAL_STATUSES, ALLERGEN_CODES, DIET_CODES, DISH_CATEGORY_CODES, CreateDishDto, DIFFICULTIES (+25 more)

### Community 61 - "Branded PDF Document Styling"
Cohesion: 0.05
Nodes (78): ASSETS, brandDocument(), brandHeader(), COLOR, FONT, footer(), label, LOGO (+70 more)

### Community 62 - "User Registration API"
Cohesion: 0.11
Nodes (17): RegisterUserDto, ApiProperty, IsEmail, PublicUsersController, ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiOperation (+9 more)

### Community 63 - "Booking Payments (URSSAF/CESU)"
Cohesion: 0.08
Nodes (33): afterTaxCredit(), BookingPaymentState, MethodReasonCode, PaymentMethodOption, REASONS, URSSAF_REASON, UrssafReasonCode, CESU_PAYMENT_INCLUDE (+25 more)

### Community 64 - "Stripe Service & Commission Invoicing"
Cohesion: 0.10
Nodes (22): StripeService, Injectable, COMMISSION_FOR_INVOICE_SELECT, CommissionForInvoice, CommissionInvoiceView, DEBITABLE_COMMISSION_STATUSES, LIVE_DEBIT_STATUSES, SEPA_MAX_AMOUNT_CENTS (+14 more)

### Community 65 - "Clerk Webhooks Controller"
Cohesion: 0.08
Nodes (24): getWebhookRawBody(), RawBodyFastifyRequest, buildWebhookHeaders(), ClerkWebhooksController, ApiExcludeController, ApiTags, Controller, HttpCode (+16 more)

### Community 66 - "Dual-Role Account & Self-Dealing Guard"
Cohesion: 0.53
Nodes (6): Analysis: one account, two spaces (client and chef switcher), Client and chef space switcher (dual-role account), Risk: attaching a chef profile to an existing account by email (account takeover), Profile-based authorisation (users.role only gates admin), Self-dealing guard (no booking, quoting or paying your own chef profile), URSSAF avance immediate (50% tax credit for services a la personne)

### Community 67 - "Stripe Connect SEPA DTOs"
Cohesion: 0.12
Nodes (27): ConfirmSepaMandateDto, CreateSepaMandateCheckoutDto, SepaMandateCheckoutDto, SepaMandateSetupIntentDto, SepaMandateStatusDto, StripeConnectLinkDto, StripeConnectStatusDto, ApiProperty (+19 more)

### Community 68 - "SEPA Mandates Service"
Cohesion: 0.28
Nodes (4): idOf(), SepaMandatesService, Injectable, customerRef()

### Community 69 - "Chef Applications Admin Service"
Cohesion: 0.15
Nodes (6): toWire(), ChefApplicationsAdminService, Injectable, ChefApplicationsService, toAnswersView(), Injectable

### Community 70 - "Missions & Shopping Lists"
Cohesion: 0.26
Nodes (4): shoppingByClient(), MissionsService, Injectable, shoppingDeadline()

### Community 71 - "Booking Withdrawal & Contract Rules"
Cohesion: 0.13
Nodes (19): WITHDRAWAL_SELECT, WITHDRAWAL_MESSAGE, withdrawalRefused(), CONTRACT_TERMS, ContractGap, mergeConsents(), easter(), EASTER_HOLIDAYS (+11 more)

### Community 72 - "Account Deletion Controller"
Cohesion: 0.10
Nodes (24): BOOKING_STATUSES, AccountDeletionController, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+16 more)

### Community 73 - "Chef Tiers & Platform Settings"
Cohesion: 0.09
Nodes (34): SupplementRules, CHEF_CAPABILITIES, CHEF_TIERS_KEY, chefTierRules(), DECIDED_CHEF_TIERS, DEFAULT_CHEF_TIER_LABELS, PlatformSettingsController, reqId() (+26 more)

### Community 74 - "Architecture & Dev Docs"
Cohesion: 0.18
Nodes (17): AGENTS.md (development and architecture instructions), audit_log: compliance journal and debugging trail, Auth testing without Clerk (sk_test_placeholder decodes JWT without JWKS), Append-only chef_documents owned by the chef profile from first upload, Legacy tables renamed aside to *_legacy, not dropped, In-house messaging (chef_client and support conversations), Raw-body webhook signature verification (preParsing hook), Redis optional (in-process fallback for messaging rate limit and events) (+9 more)

### Community 75 - "Clerk-to-DB Sync Script"
Cohesion: 0.16
Nodes (14): argv, clerkIdArg, confirmed, emailArg, main(), resolveClerkUsers(), roleArg, syncAll (+6 more)

### Community 76 - "Users-to-Clerk Sync Script"
Cohesion: 0.20
Nodes (13): assertClerkReachable(), clerk, dryRun, main(), previewClerkUser(), { prisma, pool }, isPlaceholderClerkUserId(), isRealClerkSecretKey() (+5 more)

### Community 77 - "Recipe Rules & Shopping Aggregation"
Cohesion: 0.10
Nodes (29): aggregate(), applyCorrections(), canonical(), Correction, diffCorrections(), fold(), groupByAisle(), householdPortions() (+21 more)

### Community 78 - "Mission DTOs"
Cohesion: 0.14
Nodes (25): PutDishNotesDto, PutShoppingListDto, RecipeSheetQueryDto, ShoppingLineDto, ShoppingMarkDto, SubmitShoppingListDto, ApiProperty, ApiPropertyOptional (+17 more)

### Community 79 - "NestJS CLI Config"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 80 - "Allergy Rules & Service"
Cohesion: 0.09
Nodes (40): UPCOMING, allergyCheck(), allergyLabels(), AllergyReason, checkable(), CLIENT_ALLERGY_SELECT, ClientAllergies, CODE_BY_WORD (+32 more)

### Community 81 - "CESU Payments Controller"
Cohesion: 0.18
Nodes (23): CesuPaymentsController, PublicCesuController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+15 more)

### Community 82 - "Content Photos Service"
Cohesion: 0.42
Nodes (3): ContentPhotosService, labsFoodPhotoFolder(), Injectable

### Community 83 - "App Logging & Sentry"
Cohesion: 0.26
Nodes (8): AppLogger, isEvent(), JsonOptions, LOG_BASE, redactEmails(), reportError(), currentRequest(), @sentry/nestjs

### Community 84 - "Contact Info Masking"
Cohesion: 0.40
Nodes (5): Contact details masked when served, not when stored, CONTACT_MASK, detectContact(), maskContact(), matches()

### Community 85 - "Env File Loader"
Cohesion: 0.36
Nodes (6): Env precedence: repo-root .env.local overrides shell exports, appsDir, args, findRepoRoot(), loadRepoEnv(), resolveEnvFilePaths()

### Community 86 - "Payment Intent DTOs"
Cohesion: 0.08
Nodes (31): CheckoutSessionDto, CreateCheckoutSessionDto, CreatePaymentIntentDto, FiscalAttestationProviderDto, PaymentIntentDto, ApiProperty, ApiPropertyOptional, IsIn (+23 more)

### Community 87 - "Admin Client DTOs"
Cohesion: 0.18
Nodes (17): CLIENT_STATUS_HELP, CLIENT_STATUSES, ApiPropertyOptional, IsArray, IsBoolean, IsIn, IsInt, IsOptional (+9 more)

### Community 88 - "Prisma Database Connection"
Cohesion: 0.14
Nodes (11): url, createPrismaClient(), PrismaClientBundle, PrismaLogLevel, isSupabaseCloudUrl(), PG_URL_TLS_PARAMS, postgresPoolConfig, prismaCliUrl() (+3 more)

### Community 89 - "Bookings Service Core"
Cohesion: 0.08
Nodes (38): parisHhmm(), BookingsService, Caller, changedKeys(), HOLD_MS, invalid(), isUniqueViolation(), MONEY_IN (+30 more)

### Community 90 - "Bookings DTOs & Photos"
Cohesion: 0.09
Nodes (51): ApiGeoResponses(), MAX_BOOKING_PHOTOS, STARTED, PHOTOS_EXAMPLE, AdminBookingsQueryDto, AdminUpdateBookingDto, BookingMealDto, BookingPhotoConfirmDto (+43 more)

### Community 91 - "Stripe Connect Controller"
Cohesion: 0.14
Nodes (13): StripeConnectController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, Controller, Get (+5 more)

### Community 92 - "Catalog Moderation"
Cohesion: 0.13
Nodes (16): CLEARED_MODERATION, MODERATION_REASON_CODES, REASON_LENGTH, recurringValues(), reviewFlags(), ReviewReason, ADMIN_DISH, ADMIN_MENU (+8 more)

### Community 93 - "Budget Courses Analysis Doc"
Cohesion: 0.06
Nodes (33): 0. Le bilan en bref, 1. Les deux blocs, 2.1 Les courses (carte et empreinte), 2.2 La prestation et le forfait (avance immédiate), 2.3 Cas particuliers, 2. Le parcours, étape par étape, 3. Où passe l'argent, 4.10 Données personnelles (+25 more)

### Community 94 - "Clerk User Payload Helpers"
Cohesion: 0.70
Nodes (4): clerkProfileFromUserJson(), fullNameFromClerkUser(), primaryEmailFromClerkUser(), primaryPhoneFromClerkUser()

### Community 95 - "Referentials API"
Cohesion: 0.25
Nodes (10): byLabel(), ReferentialsController, ApiOkResponse, ApiOperation, ApiParam, ApiTags, Controller, Get (+2 more)

### Community 96 - "Health Check API"
Cohesion: 0.22
Nodes (8): HealthController, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, SkipThrottle, HealthCheck

### Community 97 - "Public Chef Showcase API"
Cohesion: 0.21
Nodes (13): ApiChefIdParam(), PublicVitrineController, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse, Controller (+5 more)

### Community 98 - "SAP Declaration DTO"
Cohesion: 0.15
Nodes (14): SAP_DECLARATION_TYPES, SAP_EXTERNAL_STATUSES, SapProfileDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsIn, IsNotEmpty (+6 more)

### Community 99 - "Jest Config"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 100 - "Chef Profile Fields DTO"
Cohesion: 0.17
Nodes (12): ChefProfileFieldsDto, ApiProperty, ApiPropertyOptional, ArrayUnique, IsArray, IsIn, IsInt, IsOptional (+4 more)

### Community 101 - "Notifications API"
Cohesion: 0.13
Nodes (14): NotificationsController, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, Controller (+6 more)

### Community 102 - "Messaging Rate Limit & Storage"
Cohesion: 0.21
Nodes (4): MessagingRateLimiter, Injectable, MessagingStorageService, Injectable

### Community 103 - "TypeScript Build Config"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, tsBuildInfoFile, exclude, extends, include, ./tsconfig.json

### Community 104 - "Demo Seed Script"
Cohesion: 0.19
Nodes (13): toInputJson(), bookingStatuses, main(), { prisma, pool }, profileStatuses, quoteStatuses, DEMO_COUNT, demoBookingReference() (+5 more)

### Community 105 - "Clerk Webhooks Service"
Cohesion: 0.32
Nodes (3): ClerkWebhooksService, Injectable, isForeignKeyViolation()

### Community 106 - "Docker Build & Deploy Workflow"
Cohesion: 0.33
Nodes (5): Docker image workflow (GitHub Actions), build-run-push job, Publish image to GHCR on pushes and tags, never on PRs, Smoke test: migrate, boot, /health and /ready against a throwaway Postgres, docker-entrypoint.sh script

### Community 107 - "Quotes Service"
Cohesion: 0.18
Nodes (6): LoadedQuote, QuoteView, notFound(), QuotesService, Injectable, ChefIdentity

### Community 109 - "unseed-demo.ts"
Cohesion: 0.38
Nodes (5): main(), { prisma, pool }, DEMO_MENU_YEAR, demoFormuleId(), demoMealName()

### Community 110 - "Paris Time Utils & Agenda"
Cohesion: 0.14
Nodes (17): DAY_MS, HHMM, PARIS, parisMinute(), parisOffsetMs(), weekdayOf(), HOLDS_SLOT, BLOCK_SELECT (+9 more)

### Community 111 - "all-exceptions.filter.ts"
Cohesion: 0.33
Nodes (5): AllExceptionsFilter, Answer, answerFor(), BUSINESS_REFUSALS, Catch

### Community 112 - "Commission Calculation"
Cohesion: 0.28
Nodes (11): EarningsInput, ACCEPTED_OFFER, commissionFor(), commissionForPayment(), CommissionPolicyDb, hasDeal(), OfferDeal, rateInForce() (+3 more)

### Community 113 - "Referentials Constants"
Cohesion: 0.29
Nodes (6): METROPOLITAN_REGIONS, ALLERGENS, COMPUTED_DIETS, DIETS, DISH_CATEGORIES, STEP_TYPES

### Community 114 - "Allergies Controller"
Cohesion: 0.09
Nodes (21): AllergiesController, ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse, Body (+13 more)

### Community 115 - "Env Validation Schema"
Cohesion: 0.40
Nodes (4): CLERK_SECRET_KEY_PATTERN, envValidationSchema, Add Brevo template workflow, joi

### Community 116 - "Client Bookings Controller"
Cohesion: 0.20
Nodes (22): MeBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam (+14 more)

### Community 117 - "Chef Verification DTO"
Cohesion: 0.50
Nodes (4): ApiPropertyOptional, IsBoolean, IsOptional, UpdateChefVerificationDto

### Community 120 - "Webhook Raw Body & Request Context"
Cohesion: 0.10
Nodes (21): AppModule, Module, CLERK_WEBHOOK_PATH, registerWebhookRawBodyHook(), STRIPE_WEBHOOK_PATH, WEBHOOK_RAW_BODY_PATHS, registerRequestContext(), RequestContext (+13 more)

### Community 132 - "Quote DTOs"
Cohesion: 0.17
Nodes (26): AcceptOfferDto, CreateQuoteDto, CreateQuoteOfferDto, DeclineDto, EditableQuoteFieldsDto, ApiProperty, ApiPropertyOptional, ArrayMaxSize (+18 more)

### Community 133 - "Quote Offers Service"
Cohesion: 0.15
Nodes (9): acceptedConsents(), consentsAuditMetadata(), ConsentsInput, isUniqueViolation(), offerNotFound(), QuoteOffersService, Cron, Injectable (+1 more)

### Community 134 - "Chef Bookings Controller"
Cohesion: 0.18
Nodes (21): ChefBookingsController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+13 more)

### Community 135 - "Calendar Feed Controllers"
Cohesion: 0.06
Nodes (36): ChefCalendarFeedController, PublicCalendarFeedController, ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse (+28 more)

### Community 136 - "Shopping List & Countries"
Cohesion: 0.15
Nodes (15): shoppingListFrozen(), shoppingListNotSent(), shoppingListUpdated(), ALPHA2_TO_NUMERIC, COUNTRIES_TOTAL, country(), COUNTRY_CODES, frenchNames (+7 more)

### Community 137 - "URSSAF & Booking Payments Controllers"
Cohesion: 0.14
Nodes (24): AdminUrssafController, BookingPaymentsController, requestId(), ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse (+16 more)

### Community 138 - "Booking Reschedules Service"
Cohesion: 0.15
Nodes (20): answeredMeanwhile(), Booking, BOOKING_SELECT, BookingReschedulesService, contactOf(), endFor(), nameOf(), notFound() (+12 more)

### Community 139 - "Chef Agenda Service & Controller"
Cohesion: 0.10
Nodes (22): AgendaService, Injectable, ChefAgendaController, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse (+14 more)

### Community 140 - "Availability DTOs"
Cohesion: 0.19
Nodes (26): AgendaQueryDto, AgendaSummaryQueryDto, AvailabilityExceptionDto, ChefSlotsQueryDto, PublicSlotsQueryDto, ScheduleDto, TimeBlockDto, ApiProperty (+18 more)

### Community 141 - "Commission Debits Service"
Cohesion: 0.10
Nodes (8): addDays(), CommissionDebitsService, isUniqueViolation(), targetDate(), Injectable, idOf(), StripeWebhooksService, Injectable

### Community 142 - "Commission Invoices Controller"
Cohesion: 0.11
Nodes (24): CommissionInvoicesController, resolvePeriod(), toCommissionInvoiceDto(), ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation (+16 more)

### Community 143 - "Chef Application DTOs"
Cohesion: 0.18
Nodes (24): ApplicationAddressDto, ApplicationCompanyDto, ApplicationConsentDto, ApplicationIdentityDto, CompanySapDto, CreateChefApplicationDto, InterventionCityDto, InterventionZoneDto (+16 more)

### Community 144 - "Contact Service & DTOs"
Cohesion: 0.12
Nodes (23): Loaded, SOURCE_LABEL, WITH_REPLIES, CONTACT_RATE_LIMIT, CONTACT_SOURCES, CONTACT_STATUSES, ContactSource, DEFAULT_CONTACT_SUBJECT (+15 more)

### Community 145 - "Booking Documents Service"
Cohesion: 0.12
Nodes (16): stackOf(), addressOf(), BookingDocumentsService, chefNameOf(), CONTRACT_SELECT, ContractRow, Cron, Injectable (+8 more)

### Community 147 - "Quote Business Rules"
Cohesion: 0.11
Nodes (30): ACTIVE_OFFER, AWAITING_CHEF, CLOSED, DUPLICATE_WINDOW_MS, MAX_DAYS_AHEAD, MAX_NET_CENTS, MAX_OPEN_REQUESTS, MAX_VALIDITY_DAYS (+22 more)

### Community 148 - "Railway Deployment Guide Doc"
Cohesion: 0.09
Nodes (23): 1. Create the service, 2. Environment variables, 3. Database URLs (Supabase), 4. Public domain & API URLs, 4b. Logs and debugging, 4c. Scheduled jobs, 5. Deploy flow, 6. Local Docker vs Railway (+15 more)

### Community 149 - "Booking Email Notifications"
Cohesion: 0.19
Nodes (9): amountOrEmpty(), BookingsMailer, DAY, euros(), firstName(), Injectable, WHEN, Cron (+1 more)

### Community 151 - "Platform Settings DTOs"
Cohesion: 0.15
Nodes (22): BookingSupplementsDto, ChefTierLabelsDto, ChefTiersDto, ListItemDto, RecipeProfilesDto, ReheatModesDto, ApiProperty, ArrayMaxSize (+14 more)

### Community 152 - "Service Offer DTOs"
Cohesion: 0.06
Nodes (44): CUSTOM_OFFER_NAME, CreateServiceOfferDto, OfferPriceQueryDto, ApiProperty, ApiPropertyOptional, IsBoolean, IsInt, IsOptional (+36 more)

### Community 153 - "CGV V1 Front Plan Doc"
Cohesion: 0.09
Nodes (21): 0. Le contrat d'API à brancher, 1. Site client (`batchcooking-web`), 2. Console admin (`admin-dashboard`), 3. Après l'API du lot 6 : Budget Courses et empreinte (P2), 4. À faire hors front, 5. Recette, A1 — Les batch cookers (P1), A2 — Le détail d'une réservation (P0 pour la rétractation) (+13 more)

### Community 155 - "Security Audit Plan Doc"
Cohesion: 0.10
Nodes (20): 0. Cadre & base de références, 1.1 Failles de logique métier (le risque n°1 ici), 1.2 Injections, 1. Stratégie de test — failles logiques & injections, 2. Simulation d'attaque — Top 3 cibles (pentest théorique), 3. Audit de configuration, 4. Audit de gestion des secrets, 5. Bilan de sécurité (synthèse noir / rouge / orange) (+12 more)

### Community 156 - "Payments Evolution Register Doc"
Cohesion: 0.06
Nodes (34): CESU lifecycle, Change Log, Changed elsewhere, Configuration, Configuration Evolution, Data model evolution, Documentation Evolution, Enums (+26 more)

### Community 158 - "Stats Dashboard API"
Cohesion: 0.30
Nodes (8): StatsController, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, UseGuards

### Community 159 - "Chef Payments & Stripe Onboarding Docs"
Cohesion: 0.11
Nodes (19): 1. Model in one paragraph, 2. Prerequisites per role, 3. Endpoints, 4. Webhook — `POST /webhooks/stripe`, 5. Commission arithmetic, 6. Configuration, 7. Data model, 8. Known limitations (+11 more)

### Community 163 - "Quote Email Notifications"
Cohesion: 0.20
Nodes (5): day(), euros(), firstName(), QuotesMailer, Injectable

### Community 164 - "Chef Availability API"
Cohesion: 0.16
Nodes (15): ChefAvailabilityController, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags (+7 more)

### Community 167 - "Chef Legal Identity Views"
Cohesion: 0.06
Nodes (35): CHEF_LEGAL_SELECT, CHEF_LEGAL_STATUSES, ChefLegalGap, chefLegalIdentity, ChefLegalRow, ChefLegalStatus, STATUS_LABEL, VAT_REGIMES (+27 more)

### Community 168 - "Changelog History"
Cohesion: 0.13
Nodes (14): [1.4.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.3.0...v1.4.0) (2026-10-31), [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02), [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02), [2.0.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.5.0...v2.0.0) (2026-11-09), ⚠ BREAKING CHANGES, Bug Fixes, Bug Fixes, Bug Fixes (+6 more)

### Community 169 - "Security Audit Skill Docs"
Cohesion: 0.13
Nodes (14): Baseline connue (2026-10-20) — un run est un DIFF vs ceci, Checklist tests dynamiques (pour l'humain, env de test uniquement), Garde-fous (NON négociables), /lf-security-audit, Phase 0 — Cartographie (toujours), Phase 1 — Authentification & bootstrap  (⚫ Cible 1), Phase 2 — Autorisation objet/fonction  (🟠 Cible 2 — anti-régression), Phase 3 — Webhooks & secrets (+6 more)

### Community 171 - "Chef Showcase Query DTO"
Cohesion: 0.18
Nodes (14): ChefShowcaseQueryDto, ApiPropertyOptional, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional (+6 more)

### Community 172 - "Booking Payments API"
Cohesion: 0.25
Nodes (14): LINK_EXAMPLE, DecideUrssafLinkDto, RequestUrssafLinkDto, SettleBookingDto, SimulateUrssafOutcomeDto, ApiProperty, ApiPropertyOptional, IsIn (+6 more)

### Community 173 - "Fiscal Attestations Service"
Cohesion: 0.40
Nodes (5): attestationExclusion(), AttestationPayment, ECESU_ATTESTATION_NOTE, isPlatformAttestable(), TYPE_B_ATTESTATION_NOTE

### Community 174 - "Clerk-Postgres Identity Sync Docs"
Cohesion: 0.14
Nodes (14): 1. Clerk → Postgres (primary, ongoing), 2. Postgres → Clerk (migration / demo, one-off), 3. Request-time upsert (first sign-in), Admin provisioning (Backend API), Backfill for accounts the webhook never saw, Clerk identity + Supabase/Prisma app data, Code map, Dashboard / frontend contract (+6 more)

### Community 176 - "Contact Form Service"
Cohesion: 0.18
Nodes (6): Contact forms: stored first, emailed second, ContactService, firstNameOf(), notFound(), toView(), Injectable

### Community 177 - "Public Availability API"
Cohesion: 0.13
Nodes (13): PublicAvailabilityController, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnprocessableEntityResponse, Controller (+5 more)

### Community 178 - "Admin Chef Listing DTO"
Cohesion: 0.12
Nodes (16): CHEF_SORTS, CHEF_STATE_FILTERS, CHEF_STATE_HELP, CHEF_STATES, ChefStateFilter, ListAdminChefsQueryDto, REGION_CODES, ApiProperty (+8 more)

### Community 179 - "Admin Chefs Service"
Cohesion: 0.13
Nodes (18): Batch cookers in the back office (LF-0164, GET /admin/chefs), chefTierLabels(), AdminChefsService, BookingCounts, CHEF_SELECT, ChefRow, CONTENT_COUNTS, LIVE_ACCOUNT (+10 more)

### Community 180 - "Concept Page CMS Spec"
Cohesion: 0.15
Nodes (12): Acceptance Criteria, API Contract Draft, Current Codebase Finding, Data Model Proposal, Existing Files To Modify, F19 - Page "Notre Concept" CMS, Feature Source, `GET /content/concept` (+4 more)

### Community 184 - "In-House Calendar Migration Plan"
Cohesion: 0.17
Nodes (12): Context, Cross-check against the batchcooking-web agenda, Decided (2026-10-15), For the front team (LF-0074 and what follows), Implementation notes (where the code differs from the text above), In-house batch cooker calendar, Migrations (written, never applied by me), Order and verification (+4 more)

### Community 185 - "Database & Env Setup Docs"
Cohesion: 0.17
Nodes (12): Behavior in this repo, Env file location, Environment variables, Partially applied migrations, Prisma baseline (existing TypeORM databases), Prisma commands (ORM 7), Railway production, Supabase Postgres connection (LF-BackEnd) (+4 more)

### Community 188 - "Document Upload DTOs"
Cohesion: 0.29
Nodes (11): ConfirmUploadDto, CreateUploadUrlDto, DecideDocumentDto, ApiProperty, ApiPropertyOptional, IsDateString, IsIn, IsInt (+3 more)

### Community 191 - "URSSAF Config & Gateway"
Cohesion: 0.12
Nodes (11): AppConfig, COMMISSION_DEBIT_TRIGGERS, CommissionDebitTrigger, configLoader(), optionalNumber(), URSSAF_GATEWAY_MODES, UrssafGatewayMode, Injectable (+3 more)

### Community 194 - "Bookings/Calendar Planning Docs"
Cohesion: 0.20
Nodes (8): Assumptions to confirm, Context, Files, Implementation notes (where the code differs from this plan), Migrations (written only, never applied by me), Role-segmented bookings, batch cooker availability and Cronofy, Status, Verification

### Community 197 - "Admin User Role DTO"
Cohesion: 0.20
Nodes (11): AppUserRole, CreateAdminUserDto, ApiProperty, ApiPropertyOptional, IsEmail, IsIn, IsOptional, IsString (+3 more)

### Community 198 - "Package Dependencies"
Cohesion: 0.25
Nodes (8): glob, js-yaml, overrides, fastify, @nestjs/cli, @nestjs/swagger, @typescript-eslint/typescript-estree, minimatch

### Community 201 - "Brevo Template Security Tests"
Cohesion: 0.25
Nodes (5): Brevo template security rules, declared(), FIXTURES, RULES, SIGN_IN_EMAILS

### Community 202 - "Cronofy Calendar Integration"
Cohesion: 0.25
Nodes (8): API client: `src/integrations/cronofy.service.ts`, Booking integration, Calendar module: `src/modules/calendar/`, Config and fix, Frontend dependency (batchcooking-web; NEVER touch it unless you ask), Phase C: Cronofy (connect, free/busy, events), data center `de`, Prisma, Token encryption: `src/common/crypto/secret-box.ts`

### Community 203 - "Chef Agenda & Working Hours Plan"
Cohesion: 0.25
Nodes (8): Closed days stop requests, not counter-proposals, Errors, Logs, Phase D1: the agenda, fitted to the page, Routes (tag `chefBookings`, `ClerkAuthGuard`, approved batch cooker), Schema (migration `20261015120000_agenda`), Tests, Working hours (`/chef/availability`), fitted to how the page edits

### Community 204 - "Security Audit Report Oct24"
Cohesion: 0.25
Nodes (7): Bilan ⚫🔴🟠 (inchangé), Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici, Contrôles de régression Phase 0/2 (routes nouvelles ou modifiées depuis `b370f11`), Hors cibles, vus dans le diff (🟢, ne pas casser), Rapport d'audit sécurité — LF-BackEnd — 2026-10-24 (run `--quick`), Résultat : ✅ 0 régression — les 3 cibles sont INCHANGÉES (toujours ouvertes), ⚠️ À vérifier côté opérations (hors code)

### Community 206 - "Chef Profile Languages"
Cohesion: 0.29
Nodes (5): ISO_639_1, LANGUAGE_CODES, languageNames, LANGUAGES, UpdateMeChefProfileDto

### Community 207 - "Role-Segmented Bookings Plan"
Cohesion: 0.29
Nodes (7): Controllers, e-CESU proof of payment (payments module), Phase A: role-segmented bookings, Routes, Service: `bookings.service.ts`, Status rules: `bookings/domain/booking-status.ts`, Views, DTOs and other Phase A edits

### Community 208 - "Working Hours Availability Plan"
Cohesion: 0.29
Nodes (7): Domain, How long a pending booking holds its slot: `BookingsService.expireUnpaid`, Not included, Phase B: working hours and computed availability (no Cronofy needed), Prisma, Routes, Service: `calendar/availability.service.ts`

### Community 209 - "Error Handling & Logging Plan"
Cohesion: 0.29
Nodes (7): L1. Request context, L2. One logger, structured, L3. One exception filter, L4. Rules every phase follows, L5. Shipping logs (not built now), L6. Retrofitting Phases A and B, Phase L: error handling and logging, for every phase below

### Community 211 - "Disputed Status Phase Plan"
Cohesion: 0.33
Nodes (6): Code, Errors and logs, Phase S: a temporary `disputed` status, Rules, Tests, Why "temporary" stays in the database

### Community 212 - "Security Audit Report Oct20"
Cohesion: 0.33
Nodes (5): Bilan ⚫🔴🟠 (inchangé), Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici, Contrôles de régression Phase 0/2, Rapport d'audit sécurité — LF-BackEnd — 2026-10-20 (run `--quick`), Résultat : ✅ 0 régression — état courant = baseline

### Community 215 - "Public Availability Display Plan"
Cohesion: 0.40
Nodes (5): Errors and logs, Phase D1b: what clients see, Public availability without an offer id, `slotsLeft` from the agenda (FLOW-02 §5.1), Tests

### Community 217 - "Admin Clients Query DTO"
Cohesion: 0.50
Nodes (4): ListAdminClientsQueryDto, ApiPropertyOptional, IsEnum, IsOptional

## Ambiguous Edges - Review These
- `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` → `labsfood-web service (port 3007)`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to
- `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)` → `In-house messaging module`  [AMBIGUOUS]
  local-dev/docker-compose.yml · relation: conceptually_related_to

## Knowledge Gaps
- **797 isolated node(s):** `PublicChef`, `StoredZone`, `SeasonCode`, `SeasonReviewReason`, `Answer` (+792 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1473 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Contact received admin email (BREVO_TPL_CONTACT_RECEIVED_ADMIN)` and `labsfood-web service (port 3007)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Stream API env vars (STREAM_API_KEY/SECRET/APP_ID)` and `In-house messaging module`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `@nestjs/common` connect `App Module Wiring` to `Clerk Auth Guards`, `User Response DTOs`, `Audit & Chef Onboarding Rules`, `Calendar Feed Controllers`, `Shopping List & Countries`, `Booking Reschedules Service`, `Storefront (Vitrine) Rules`, `Admin Content & Labs Food DTOs`, `Dish Suggestions Service`, `Catalog Ingredients DTOs`, `Contact Service & DTOs`, `Booking Documents Service`, `Messaging WebSocket Gateway`, `Package Metadata Config`, `Dishes Test Helpers`, `Booking Email Notifications`, `KYC Document Storage & CESU DTOs`, `Messaging DTOs`, `Catalog Service (Meals/Menus)`, `Pagination Utilities`, `Quote Business Rules`, `R2 Photo Storage Service`, `Service Offer DTOs`, `Chef Content Service & Errors`, `Supabase Storage Service`, `Chef Legal Identity Views`, `CORS Configuration`, `Messaging Rules & Contact Release`, `Booking Payments API`, `Fiscal Attestations Service`, `Availability Service`, `Brevo Email Service`, `Geo Service & Commune Rules`, `Admin Chefs Service`, `Chef Onboarding Swagger Examples`, `Branded PDF Document Styling`, `Booking Payments (URSSAF/CESU)`, `Stripe Service & Commission Invoicing`, `Clerk Webhooks Controller`, `URSSAF Config & Gateway`, `Stripe Connect SEPA DTOs`, `Booking Withdrawal & Contract Rules`, `Account Deletion Controller`, `Chef Tiers & Platform Settings`, `Users-to-Clerk Sync Script`, `Recipe Rules & Shopping Aggregation`, `Mission DTOs`, `Allergy Rules & Service`, `App Logging & Sentry`, `Bookings Service Core`, `Bookings DTOs & Photos`, `Catalog Moderation`, `Paris Time Utils & Agenda`, `all-exceptions.filter.ts`, `Referentials Constants`, `Webhook Raw Body & Request Context`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `ClerkUser` connect `Quotes Controllers` to `Contact Messages Controller`, `Clerk Auth Guards`, `User Response DTOs`, `Chef Applications Controller`, `Chef Bookings Controller`, `Calendar Feed Controllers`, `Client Content Controller`, `Admin Content Moderation`, `URSSAF & Booking Payments Controllers`, `Chef Agenda Service & Controller`, `Admin Content & Labs Food DTOs`, `Admin Chefs Controller`, `Catalog Ingredients DTOs`, `Commission Invoices Controller`, `Swagger API Decorators`, `Admin Bookings Controller`, `Messaging DTOs`, `Service Offer DTOs`, `Client Conversations Controller`, `Admin Conversations Controller`, `Fiscal Attestations Controller`, `Stats Dashboard API`, `Chef Applications Admin Controller`, `Chef Availability API`, `Avatar Controller`, `Booking Payments API`, `Missions Controller`, `Chef Documents Controller`, `Chef Onboarding Swagger Examples`, `Branded PDF Document Styling`, `Stripe Connect SEPA DTOs`, `Account Deletion Controller`, `Chef Tiers & Platform Settings`, `Mission DTOs`, `CESU Payments Controller`, `Payment Intent DTOs`, `Bookings DTOs & Photos`, `Stripe Connect Controller`, `Notifications API`, `Allergies Controller`, `Client Bookings Controller`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `CurrentClerkUser` connect `Client Conversations Controller` to `Contact Messages Controller`, `Quotes Controllers`, `Clerk Auth Guards`, `User Response DTOs`, `Chef Applications Controller`, `Chef Bookings Controller`, `Calendar Feed Controllers`, `Client Content Controller`, `Admin Content Moderation`, `URSSAF & Booking Payments Controllers`, `Chef Agenda Service & Controller`, `Admin Content & Labs Food DTOs`, `Admin Chefs Controller`, `Catalog Ingredients DTOs`, `Commission Invoices Controller`, `Swagger API Decorators`, `Admin Bookings Controller`, `Messaging DTOs`, `Service Offer DTOs`, `Admin Conversations Controller`, `Fiscal Attestations Controller`, `Stats Dashboard API`, `Chef Applications Admin Controller`, `Chef Availability API`, `Avatar Controller`, `Booking Payments API`, `Missions Controller`, `Chef Documents Controller`, `Chef Onboarding Swagger Examples`, `Branded PDF Document Styling`, `Stripe Connect SEPA DTOs`, `Account Deletion Controller`, `Chef Tiers & Platform Settings`, `Mission DTOs`, `CESU Payments Controller`, `Payment Intent DTOs`, `Bookings DTOs & Photos`, `Stripe Connect Controller`, `Notifications API`, `Allergies Controller`, `Client Bookings Controller`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `PublicChef`, `StoredZone`, `SeasonCode` to the rest of the system?**
  _797 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Users & Stats Services` be split into smaller, more focused modules?**
  _Cohesion score 0.06313497822931785 - nodes in this community are weakly interconnected._