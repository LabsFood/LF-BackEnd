# Graph Report - LF-BackEnd  (2026-09-09)

## Corpus Check
- 82 files · ~174,941 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3549 nodes · 3716 edges · 105 communities (51 shown, 54 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f910479e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.module.ts
- prismaNamespace.ts
- Booking.ts
- ChefProfile.ts
- commonInputTypes.ts
- User.ts
- integrations.module.ts
- Commission.ts
- CommissionInvoice.ts
- package.json
- Payment.ts
- Meal.ts
- BookingMeal.ts
- ServiceOffer.ts
- CesuSettlement.ts
- MenuWeekMeal.ts
- ClientProfile.ts
- Quote.ts
- ShoppingList.ts
- CommissionDebit.ts
- BookingsController
- Formule.ts
- MenuWeek.ts
- CmsPage.ts
- AvailabilitySlot.ts
- ShoppingItem.ts
- SapProfile.ts
- SepaMandate.ts
- typeorm_migrations.ts
- StripeEventLog.ts
- enums.ts
- prismaNamespaceBrowser.ts
- PrismaClient
- LF BackEnd
- get_settings
- client.ts
- models/__init__.py
- compilerOptions
- AvailabilitySlotDelegate
- BookingDelegate
- BookingMealDelegate
- CesuSettlementDelegate
- ChefProfileDelegate
- ClientProfileDelegate
- CmsPageDelegate
- CommissionDelegate
- CommissionDebitDelegate
- CommissionInvoiceDelegate
- FormuleDelegate
- main.ts
- MealDelegate
- MenuWeekDelegate
- MenuWeekMealDelegate
- PaymentDelegate
- QuoteDelegate
- SapProfileDelegate
- SepaMandateDelegate
- ServiceOfferDelegate
- ShoppingItemDelegate
- ShoppingListDelegate
- StripeEventLogDelegate
- typeorm_migrationsDelegate
- UserDelegate
- bookings.py
- nest-cli.json
- health.py
- clerk.py
- Prisma__ChefProfileClient
- dependencies
- Prisma__BookingClient
- Prisma__UserClient
- class.ts
- devDependencies
- scripts
- Prisma__CommissionClient
- Prisma__CommissionInvoiceClient
- Prisma__PaymentClient
- Prisma__BookingMealClient
- Prisma__CesuSettlementClient
- Prisma__MealClient
- Prisma__MenuWeekMealClient
- Prisma__ServiceOfferClient
- Prisma__ShoppingListClient
- 0001_init.sql
- 0001_init.py
- CronofyService
- HealthController
- Prisma__AvailabilitySlotClient
- Prisma__ClientProfileClient
- Prisma__CmsPageClient
- Prisma__CommissionDebitClient
- Prisma__FormuleClient
- Prisma__MenuWeekClient
- Prisma__QuoteClient
- Prisma__SapProfileClient
- Prisma__SepaMandateClient
- Prisma__ShoppingItemClient
- read_thisUser
- api-fastapi
- Prisma__StripeEventLogClient
- Prisma__typeorm_migrationsClient
- .http
- .http
- migrations/README.md
- lf-api-fastapi

## God Nodes (most connected - your core abstractions)
1. `PrismaClient` - 34 edges
2. `compilerOptions` - 19 edges
3. `AvailabilitySlotDelegate` - 18 edges
4. `BookingDelegate` - 18 edges
5. `BookingMealDelegate` - 18 edges
6. `CesuSettlementDelegate` - 18 edges
7. `ChefProfileDelegate` - 18 edges
8. `ClientProfileDelegate` - 18 edges
9. `CmsPageDelegate` - 18 edges
10. `CommissionDelegate` - 18 edges

## Surprising Connections (you probably didn't know these)
- `require_clerk_user()` --uses--> `Settings`  [INFERRED]
  apps/api-fastapi/app/auth/clerk.py → apps/api-fastapi/app/config.py
- `create_app()` --calls--> `get_settings()`  [EXTRACTED]
  apps/api-fastapi/app/main.py → apps/api-fastapi/app/config.py
- `Booking` --inherits--> `Base`  [EXTRACTED]
  apps/api-fastapi/app/models/booking.py → apps/api-fastapi/app/database.py
- `ProviderProfile` --inherits--> `Base`  [EXTRACTED]
  apps/api-fastapi/app/models/provider.py → apps/api-fastapi/app/database.py
- `ServiceOffer` --inherits--> `Base`  [EXTRACTED]
  apps/api-fastapi/app/models/provider.py → apps/api-fastapi/app/database.py

## Import Cycles
- None detected.

## Communities (105 total, 54 thin omitted)

### Community 0 - "app.module.ts"
Cohesion: 0.23
Nodes (9): AuthModule, Module, AppConfig, configLoader(), BookingsModule, Module, HealthModule, Module (+1 more)

### Community 1 - "prismaNamespace.ts"
Cohesion: 0.01
Nodes (177): AnyNull, Args, At, AtLeast, AtLoose, AtStrict, AvailabilitySlotScalarFieldEnum, BatchPayload (+169 more)

### Community 2 - "Booking.ts"
Cohesion: 0.01
Nodes (164): AggregateBooking, Booking$bookingMealsArgs, Booking$formuleArgs, Booking$paymentsArgs, Booking$shoppingListArgs, BookingAggregateArgs, BookingAvgAggregateInputType, BookingAvgAggregateOutputType (+156 more)

### Community 3 - "ChefProfile.ts"
Cohesion: 0.01
Nodes (154): AggregateChefProfile, BoolFieldUpdateOperationsInput, ChefProfile$availabilitySlotsArgs, ChefProfile$bookingsArgs, ChefProfile$commissionInvoicesArgs, ChefProfile$commissionsArgs, ChefProfile$sapProfileArgs, ChefProfile$sepaMandateArgs (+146 more)

### Community 4 - "commonInputTypes.ts"
Cohesion: 0.02
Nodes (131): BigIntFilter, BigIntWithAggregatesFilter, BoolFilter, BoolWithAggregatesFilter, DateTimeFilter, DateTimeNullableFilter, DateTimeNullableWithAggregatesFilter, DateTimeWithAggregatesFilter (+123 more)

### Community 5 - "User.ts"
Cohesion: 0.02
Nodes (128): AggregateUser, DateTimeFieldUpdateOperationsInput, EnumUserRoleFieldUpdateOperationsInput, GetUserAggregateType, GetUserGroupByPayload, NullableStringFieldUpdateOperationsInput, StringFieldUpdateOperationsInput, User$bookingsAsClientArgs (+120 more)

### Community 6 - "integrations.module.ts"
Cohesion: 0.12
Nodes (9): BrevoService, Injectable, IntegrationsModule, Module, StreamService, Injectable, StripeService, Injectable (+1 more)

### Community 7 - "Commission.ts"
Cohesion: 0.02
Nodes (109): AggregateCommission, Commission$commissionInvoiceArgs, CommissionAggregateArgs, CommissionAvgAggregateInputType, CommissionAvgAggregateOutputType, CommissionAvgOrderByAggregateInput, CommissionCountAggregateInputType, CommissionCountAggregateOutputType (+101 more)

### Community 8 - "CommissionInvoice.ts"
Cohesion: 0.02
Nodes (107): AggregateCommissionInvoice, CommissionInvoice$commissionsArgs, CommissionInvoice$debitsArgs, CommissionInvoiceAggregateArgs, CommissionInvoiceAvgAggregateInputType, CommissionInvoiceAvgAggregateOutputType, CommissionInvoiceAvgOrderByAggregateInput, CommissionInvoiceCountAggregateInputType (+99 more)

### Community 9 - "package.json"
Cohesion: 0.10
Nodes (19): author, description, keywords, license, name, private, version, class-transformer (+11 more)

### Community 10 - "Payment.ts"
Cohesion: 0.02
Nodes (102): AggregatePayment, EnumPaymentMethodFieldUpdateOperationsInput, EnumPaymentStatusFieldUpdateOperationsInput, GetPaymentAggregateType, GetPaymentGroupByPayload, Payment$cesuSettlementArgs, Payment$commissionArgs, PaymentAggregateArgs (+94 more)

### Community 11 - "Meal.ts"
Cohesion: 0.02
Nodes (96): AggregateMeal, EnumMealStatusFieldUpdateOperationsInput, GetMealAggregateType, GetMealGroupByPayload, Meal$bookingMealsArgs, Meal$menuWeeksArgs, MealAggregateArgs, MealAvgAggregateInputType (+88 more)

### Community 12 - "BookingMeal.ts"
Cohesion: 0.02
Nodes (95): AggregateBookingMeal, BookingMealAggregateArgs, BookingMealAvgAggregateInputType, BookingMealAvgAggregateOutputType, BookingMealAvgOrderByAggregateInput, BookingMealBookingIdMealIdCompoundUniqueInput, BookingMealCountAggregateInputType, BookingMealCountAggregateOutputType (+87 more)

### Community 13 - "ServiceOffer.ts"
Cohesion: 0.02
Nodes (94): AggregateServiceOffer, GetServiceOfferAggregateType, GetServiceOfferGroupByPayload, ServiceOffer$bookingsArgs, ServiceOfferAggregateArgs, ServiceOfferAvgAggregateInputType, ServiceOfferAvgAggregateOutputType, ServiceOfferAvgOrderByAggregateInput (+86 more)

### Community 14 - "CesuSettlement.ts"
Cohesion: 0.02
Nodes (89): AggregateCesuSettlement, CesuSettlement$confirmedByArgs, CesuSettlementAggregateArgs, CesuSettlementCountAggregateInputType, CesuSettlementCountAggregateOutputType, CesuSettlementCountArgs, CesuSettlementCountOrderByAggregateInput, CesuSettlementCreateArgs (+81 more)

### Community 15 - "MenuWeekMeal.ts"
Cohesion: 0.02
Nodes (89): AggregateMenuWeekMeal, GetMenuWeekMealAggregateType, GetMenuWeekMealGroupByPayload, MenuWeekMealAggregateArgs, MenuWeekMealCountAggregateInputType, MenuWeekMealCountAggregateOutputType, MenuWeekMealCountArgs, MenuWeekMealCountOrderByAggregateInput (+81 more)

### Community 16 - "ClientProfile.ts"
Cohesion: 0.02
Nodes (83): AggregateClientProfile, ClientProfileAggregateArgs, ClientProfileAvgAggregateInputType, ClientProfileAvgAggregateOutputType, ClientProfileAvgOrderByAggregateInput, ClientProfileCountAggregateInputType, ClientProfileCountAggregateOutputType, ClientProfileCountArgs (+75 more)

### Community 17 - "Quote.ts"
Cohesion: 0.02
Nodes (82): AggregateQuote, EnumQuoteStatusFieldUpdateOperationsInput, GetQuoteAggregateType, GetQuoteGroupByPayload, QuoteAggregateArgs, QuoteAvgAggregateInputType, QuoteAvgAggregateOutputType, QuoteAvgOrderByAggregateInput (+74 more)

### Community 18 - "ShoppingList.ts"
Cohesion: 0.02
Nodes (82): AggregateShoppingList, GetShoppingListAggregateType, GetShoppingListGroupByPayload, ShoppingList$itemsArgs, ShoppingListAggregateArgs, ShoppingListCountAggregateInputType, ShoppingListCountAggregateOutputType, ShoppingListCountArgs (+74 more)

### Community 19 - "CommissionDebit.ts"
Cohesion: 0.02
Nodes (80): AggregateCommissionDebit, CommissionDebitAggregateArgs, CommissionDebitAvgAggregateInputType, CommissionDebitAvgAggregateOutputType, CommissionDebitAvgOrderByAggregateInput, CommissionDebitCountAggregateInputType, CommissionDebitCountAggregateOutputType, CommissionDebitCountArgs (+72 more)

### Community 20 - "BookingsController"
Cohesion: 0.13
Nodes (13): ApiBearerAuth, ApiTags, ClerkAuthGuard, ClerkUser, decodeUnverifiedJwt(), Injectable, BookingsController, Controller (+5 more)

### Community 21 - "Formule.ts"
Cohesion: 0.03
Nodes (78): AggregateFormule, Formule$bookingsArgs, FormuleAggregateArgs, FormuleAvgAggregateInputType, FormuleAvgAggregateOutputType, FormuleAvgOrderByAggregateInput, FormuleCountAggregateInputType, FormuleCountAggregateOutputType (+70 more)

### Community 22 - "MenuWeek.ts"
Cohesion: 0.03
Nodes (77): AggregateMenuWeek, GetMenuWeekAggregateType, GetMenuWeekGroupByPayload, MenuWeek$mealsArgs, MenuWeekAggregateArgs, MenuWeekAvgAggregateInputType, MenuWeekAvgAggregateOutputType, MenuWeekAvgOrderByAggregateInput (+69 more)

### Community 23 - "CmsPage.ts"
Cohesion: 0.03
Nodes (74): AggregateCmsPage, CmsPage$updatedByArgs, CmsPageAggregateArgs, CmsPageCountAggregateInputType, CmsPageCountAggregateOutputType, CmsPageCountArgs, CmsPageCountOrderByAggregateInput, CmsPageCreateArgs (+66 more)

### Community 24 - "AvailabilitySlot.ts"
Cohesion: 0.03
Nodes (73): AggregateAvailabilitySlot, AvailabilitySlotAggregateArgs, AvailabilitySlotCountAggregateInputType, AvailabilitySlotCountAggregateOutputType, AvailabilitySlotCountArgs, AvailabilitySlotCountOrderByAggregateInput, AvailabilitySlotCreateArgs, AvailabilitySlotCreateInput (+65 more)

### Community 25 - "ShoppingItem.ts"
Cohesion: 0.03
Nodes (73): AggregateShoppingItem, GetShoppingItemAggregateType, GetShoppingItemGroupByPayload, ShoppingItemAggregateArgs, ShoppingItemCountAggregateInputType, ShoppingItemCountAggregateOutputType, ShoppingItemCountArgs, ShoppingItemCountOrderByAggregateInput (+65 more)

### Community 26 - "SapProfile.ts"
Cohesion: 0.03
Nodes (69): AggregateSapProfile, EnumSapDeclarationTypeFieldUpdateOperationsInput, EnumSapExternalStatusFieldUpdateOperationsInput, GetSapProfileAggregateType, GetSapProfileGroupByPayload, SapProfileAggregateArgs, SapProfileCountAggregateInputType, SapProfileCountAggregateOutputType (+61 more)

### Community 27 - "SepaMandate.ts"
Cohesion: 0.03
Nodes (68): AggregateSepaMandate, EnumSepaMandateStatusFieldUpdateOperationsInput, GetSepaMandateAggregateType, GetSepaMandateGroupByPayload, SepaMandateAggregateArgs, SepaMandateCountAggregateInputType, SepaMandateCountAggregateOutputType, SepaMandateCountArgs (+60 more)

### Community 28 - "typeorm_migrations.ts"
Cohesion: 0.03
Nodes (59): AggregateTypeorm_migrations, BigIntFieldUpdateOperationsInput, GetTypeorm_migrationsAggregateType, GetTypeorm_migrationsGroupByPayload, Typeorm_migrationsAggregateArgs, Typeorm_migrationsAvgAggregateInputType, Typeorm_migrationsAvgAggregateOutputType, typeorm_migrationsAvgOrderByAggregateInput (+51 more)

### Community 29 - "StripeEventLog.ts"
Cohesion: 0.04
Nodes (52): AggregateStripeEventLog, GetStripeEventLogAggregateType, GetStripeEventLogGroupByPayload, StripeEventLogAggregateArgs, StripeEventLogCountAggregateInputType, StripeEventLogCountAggregateOutputType, StripeEventLogCountArgs, StripeEventLogCountOrderByAggregateInput (+44 more)

### Community 30 - "enums.ts"
Cohesion: 0.04
Nodes (44): AvailabilitySlot, Booking, BookingMeal, CesuSettlement, ChefProfile, ClientProfile, CmsPage, Commission (+36 more)

### Community 31 - "prismaNamespaceBrowser.ts"
Cohesion: 0.05
Nodes (37): AnyNull, AvailabilitySlotScalarFieldEnum, BookingMealScalarFieldEnum, BookingScalarFieldEnum, CesuSettlementScalarFieldEnum, ChefProfileScalarFieldEnum, ClientProfileScalarFieldEnum, CmsPageScalarFieldEnum (+29 more)

### Community 33 - "LF BackEnd"
Cohesion: 0.07
Nodes (23): api-nestjs, Run locally (without Docker), Run with Compose, Architecture — Phase 1, Authentication (Phase 1), Data model (Phase 1 baseline), Integrations (Phase 1), Runtime flow (+15 more)

### Community 34 - "get_settings"
Cohesion: 0.10
Nodes (16): get_settings(), Return process-wide Settings, cached so env is parsed only once., BrevoClient, Brevo (transactional email) placeholder client., Whether a Brevo API key was loaded from env., CronofyClient, Cronofy placeholder client., Whether both Cronofy OAuth client credentials are present. (+8 more)

### Community 35 - "client.ts"
Cohesion: 0.07
Nodes (26): AvailabilitySlot, Booking, BookingMeal, CesuSettlement, ChefProfile, ClientProfile, CmsPage, Commission (+18 more)

### Community 36 - "models/__init__.py"
Cohesion: 0.16
Nodes (16): Emit migrations as SQL against the configured URL without opening a connection., Run migrations against a live database connection (standard path)., run_migrations_offline(), run_migrations_online(), Base, Labs Food FastAPI booking service., Booking, BookingStatus (+8 more)

### Community 37 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+13 more)

### Community 49 - "main.ts"
Cohesion: 0.33
Nodes (4): AppModule, Module, @nestjs/core, @nestjs/platform-fastify

### Community 63 - "bookings.py"
Cohesion: 0.17
Nodes (15): get_db(), Session, FastAPI dependency that yields a scoped SQLAlchemy session per request., BookingCreate, BookingRead, create_booking(), list_bookings(), ClerkUser (+7 more)

### Community 64 - "nest-cli.json"
Cohesion: 0.13
Nodes (14): collection, compilerOptions, assets, deleteOutDir, plugins, tsConfigPath, watchAssets, webpack (+6 more)

### Community 65 - "health.py"
Cohesion: 0.21
Nodes (10): create_app(), Build and configure the FastAPI application (CORS, routers, OpenAPI)., health(), get, Session, Liveness probe: returns ``ok`` as long as the process is serving., Readiness probe: verifies Postgres and Redis connectivity., ready() (+2 more)

### Community 66 - "clerk.py"
Cohesion: 0.24
Nodes (9): ClerkUser, _extract_bearer(), Clerk authentication stub. Phase 1 implementation verifies the presence of a…, Return the raw token from an ``Authorization: Bearer ...`` header or 401., Protect a route by requiring a Clerk Bearer token and returning its claims., require_clerk_user(), Parse CORS_ORIGINS env string into a clean list of allowed origins., Settings (+1 more)

### Community 68 - "dependencies"
Cohesion: 0.18
Nodes (11): dependencies, class-transformer, class-validator, @fastify/helmet, @nestjs/common, @nestjs/config, @nestjs/core, @nestjs/platform-fastify (+3 more)

### Community 71 - "class.ts"
Cohesion: 0.22
Nodes (3): config, LogOptions, PrismaClientConstructor

### Community 72 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, @nestjs/cli, @nestjs/schematics, @nestjs/testing, ts-node, tsconfig-paths, @types/node, typescript

### Community 73 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, lint, start, start:dev, start:prod, test

### Community 83 - "0001_init.sql"
Cohesion: 0.73
Nodes (5): availability_slots, bookings, provider_profiles, service_offers, users

### Community 84 - "0001_init.py"
Cohesion: 0.40
Nodes (4): downgrade(), Revert the Phase 1 schema in reverse dependency order., Create the Phase 1 core schema: users, providers, offers, slots, bookings., upgrade()

### Community 86 - "HealthController"
Cohesion: 0.50
Nodes (3): HealthController, Controller, Get

### Community 97 - "read_thisUser"
Cohesion: 0.50
Nodes (4): ClerkUser, get, Return the authenticated Clerk user's identifiers (protected sample route)., read_thisUser()

### Community 98 - "api-fastapi"
Cohesion: 0.50
Nodes (3): api-fastapi, Run locally (without Docker), Run with Compose (recommended)

## Knowledge Gaps
- **2693 isolated node(s):** `lf-api-fastapi`, `$schema`, `collection`, `sourceRoot`, `deleteOutDir` (+2688 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 3336 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **54 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MenuWeekMealDelegate` connect `MenuWeekMealDelegate` to `MenuWeekMeal.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `QuoteDelegate` connect `QuoteDelegate` to `Quote.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `AvailabilitySlotDelegate` connect `AvailabilitySlotDelegate` to `AvailabilitySlot.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `lf-api-fastapi`, `$schema`, `collection` to the rest of the system?**
  _2693 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `prismaNamespace.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.011235955056179775 - nodes in this community are weakly interconnected._
- **Should `Booking.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.012121212121212121 - nodes in this community are weakly interconnected._
- **Should `ChefProfile.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.012903225806451613 - nodes in this community are weakly interconnected._