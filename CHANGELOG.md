## [2.1.0](https://github.com/LabsFood/LF-BackEnd/compare/v2.0.0...v2.1.0) (2026-11-10)

### Features

* launch readiness, security fixes ([#85](https://github.com/LabsFood/LF-BackEnd/issues/85)) ([0d8b02d](https://github.com/LabsFood/LF-BackEnd/commit/0d8b02d5931ac71c0cc042c2995b13fb0d9e5d5a))

### Bug Fixes

* **users:** keep the phone typed in the app when Clerk has none ([1b219a8](https://github.com/LabsFood/LF-BackEnd/commit/1b219a886dbd1b93d5a0e74cab2c6cc8b6e4181a))

## [2.0.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.5.0...v2.0.0) (2026-11-09)

### ⚠ BREAKING CHANGES

* the dishes returned by GET /menus/week, GET /chefs/{id} and
GET /chefs/{id}/showcase no longer have prepMinutes, cookMinutes or calories. Read them
from the chef and admin routes, which still return them.

* feat(users): add four chef tiers with admin-editable names

Recettes lot 0, step 2 (LF-0192; LF-0193 stays blocked on BLK-26).

- ChefTier enum (tier_1 to tier_4) on chef_profiles, tier_1 by default. Migration
  20261031120000_chef_tiers is written, not applied.
- GET/PUT /admin/settings/chef-tiers: the name of each code in the chef_tiers platform
  setting, neutral ("Palier 1".."Palier 4") until an admin renames them; audited.
- PATCH /admin/chefs/{id}/tier: logged and audited with before and after.
- tier and tierLabel on GET /admin/chefs, GET /admin/chefs/{id} and GET /me/profile.
- No billing and no publication rule: assertCanPublish marks where the tier check goes.

* feat(notifications): add the in-app notification feed

Recettes lot 0, step 3 (LF-0194).

- Notification model: recipient, type, subject (type and id), readAt. It never holds
  what the notification says, so no allergy or personal data. Migration
  20261031130000_notifications is written, not applied.
- GET /me/notifications: the caller's own, newest first, paginated (100 at most per
  page), with unreadCount for the bell.
- POST /me/notifications/{id}/read: once; someone else's answers 404
  NOTIFICATION_NOT_FOUND.
- NotificationsService.notify() is exported for lots 1, 3 and 4. No e-mail is sent.

* fix(notifications): replace the unused legacy notifications table

The first schema (20250522130000_spec_domain) created a "notifications" table
(channel, payload) and a notification_channel enum. Their model was removed later
but no migration dropped them, so CREATE TABLE "notifications" failed on every
database, and in the image check that replays all migrations.

The migration now drops the legacy table and enum before creating the new table.
A guard stops it, with an explicit error, if the legacy table holds any row: data
is moved by hand, never dropped silently. Empty on DEV; no code references either.

Not applied anywhere yet, so the file can still change.

* feat(shopping-lists): the client answers the shopping list until noon the day before

Recettes lot 4, client part (LF-0279 to LF-0282, part of LF-0286), when the batch
cooker does the shopping.

- POST /chef-missions/{id}/shopping-list/send: the chef sends the list, or sends it
  again after a correction. Each send bumps the version and tells the client in the
  app (shopping_list.sent, then shopping_list.updated).
- POST /me/bookings/{id}/shopping-list/submit: the client sends their final list, what
  they already have and a comment per line, with the version they saw. A newer send
  answers 409 SHOPPING_LIST_UPDATED, before any send 409 SHOPPING_LIST_NOT_SENT, from
  noon (Paris) the day before 409 SHOPPING_LIST_FROZEN. The chef is told
  (shopping_list.final_received).
- Both answer 409 SHOPPING_BY_CLIENT when the client does the shopping.
- The answers live on the list (client_marks), keyed by ingredient and unit, because
  the lines are rebuilt on every recalculation. An answer lapses when its quantity
  changes.
- Status (preparing, sent, update_sent, final_received, frozen) and deadline are
  computed, not stored: shopping-lists/domain/shopping-list.rules.ts.
- Logs carry the number of answers, never the comments. A failed notification is
  logged and does not undo the send.

Migration 20261031140000_shopping_list_answers adds four columns to shopping_lists. It
is written, not applied.

* feat(allergies)!: clients declare their allergies with consent, or none

Recettes lot 1, step 1 (LF-0205, LF-0206, LF-0207, profile part of LF-0209).

- client_profiles: allergies holds only the 14 regulated codes (a CHECK enforces
  it), customAllergies the rest in the client's words, then allergiesNone,
  allergiesDeclaredAt (null: never answered), healthConsentAt and
  healthConsentVersion.
- PUT /me/profile/allergies: a list with consent to the current text, or
  { "none": true }. A list without consent, or with an older version, answers 422
  HEALTH_CONSENT_REQUIRED with the version to accept; "none" next to a list, or an
  empty list, 422 VALIDATION_FAILED.
- DELETE /me/profile/health-consent erases the allergies with the consent: the
  question comes back.
- GET /me/profile adds healthConsent (text and version) and, on the profile,
  allergyCheck with its reasons. The text is a draft until legal validates it
  (BLK-25).
- The batch cooker reads the allergies in French, free text included: booking
  detail, client card in the messaging.
- Rules in allergies/domain/allergies.rules.ts, tested first. Logs carry counts,
  never an allergy. A separate module, because NotificationsModule already imports
  UsersModule.
* PATCH /me/profile and PATCH /admin/clients/{id} refuse
`allergies` (400). GET /admin/clients rows no longer carry allergies nor
customAllergies. The booking detail's `allergies` are French labels.

Migration 20261102100000_client_allergies moves the existing free text, word for
word, into custom_allergies, in place of the mapping script LF-0207 planned. It is
written, not applied.

* feat(bookings)!: refuse a menu the client's allergies do not clear

Recettes lot 1, step 2 (LF-0208, booking part of LF-0209).

- Creating a booking with dishes, or changing its dishes, is refused for every
  caller, admins included, in this order: 422 ALLERGIES_NOT_DECLARED while the
  client never answered, 422 ALLERGENS_UNVERIFIED (mealIds) for a dish that
  declares neither allergens nor "none", 422 ALLERGEN_CONFLICT (conflicts) for a
  dish holding a declared allergen. Free text that names one of the 14, from the
  client or the quote request, counts.
- Booking rows and details carry allergyCheck ("verified" only when nothing is
  left to check by hand) and allergyCheckReasons. A row never carries the
  allergies themselves.
- The rule is menuRefusal in allergies.rules.ts, tested first.
* booking a menu now requires declared allergies; every existing
client has to declare before their next menu (LF-0221).

* feat(allergies): re-check upcoming menus when the client's allergies change

Recettes lot 1, step 3 (LF-0210, R41).

- After a declaration, each prestation still to cook (pending to cooking, not yet
  over, with dishes) is checked again. A dish newly in conflict notifies the
  client (allergy.conflict) and the batch cooker (mission.allergy_conflict), in
  the app, with the booking as subject. A conflict already there stays quiet.
- Best effort: the declaration stands whatever happens, a failure is logged
  (client.allergies_recheck_failed), and the booking shows its conflicts live.
- The booking detail lists allergyConflicts: each dish to replace and the
  allergens it holds.
- Logs carry ids and counts, never an allergy.

* feat(bookings): replace a dish in conflict with the client's allergies

Recettes lot 1, step 4 (LF-0211).

- POST /me/bookings/{id}/meals/replace and POST /chef/bookings/{id}/meals/replace,
  body { from, to }: swaps a dish in conflict for another, keeping its portions,
  then rebuilds the shopping list.
- Any status before delivery: there is no menu freeze yet (lot 3), and this route
  is the exception it will need. 409 BOOKING_LOCKED once delivered, completed or
  cancelled.
- Only a dish in conflict, and only for a safe one: 422 VALIDATION_FAILED when
  `from` is not in conflict or `to` is already on the menu, then the usual checks
  on the new dish alone (MEAL_UNAVAILABLE, ALLERGENS_UNVERIFIED,
  ALLERGEN_CONFLICT).
- Logged as booking.allergy_meal_replaced, with ids and the caller's role.

* chore(release): 1.5.0 [skip ci]

## [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02)

### Features

* integrate geo.api.gouv.fr for address validation across modules ([427dd75](https://github.com/LabsFood/LF-BackEnd/commit/427dd75190ac4701b173e2a1ddde03309efd2ca9))
* **users:** add listUsers endpoint for admin to retrieve user accounts ([070b2f8](https://github.com/LabsFood/LF-BackEnd/commit/070b2f88c8ea7a22253f923a9009fc21436e580a))

### Bug Fixes

* **tls:** distrust eMudhra (emSign) root CAs ([164a4cb](https://github.com/LabsFood/LF-BackEnd/commit/164a4cb95b398f2e5554ae1b7daec11dd17af967))

* refactor(pdf): share the brand helpers and the PDF text extraction

The batchcooking identity (logo, palette, embedded fonts, header, panels,
footer) moves out of the SEPA mandate into common/pdf/brand.ts so every
document the API prints wears it. The specs' text extraction moves to
common/pdf/pdf.test-helpers.ts.

The extraction no longer accepts \r\n before endstream: PDFKit always
writes a bare \n, and the optional \r ate the last byte of a compressed
stream ending in 0x0D, which made inflate fail at random.

* feat(payments): rules for the lines and number of invoice A

Invoice A is the invoice the client receives for a card payment, in the
chef's name. Pure rules, test-first:
- numbering <prefix>-<year>-NNNN, the year read in Paris;
- a payment covering the whole booking shows its breakdown (base,
  shopping, extra adults, extra dishes); a part payment is one line,
  since the booking does not record which share of the extras it paid;
- the lines always add up to the amount paid.

* refactor(pdf): share the brand helpers and the PDF text extraction

The batchcooking identity (logo, palette, embedded fonts, header, panels,
footer) moves out of the SEPA mandate into common/pdf/brand.ts so every
document the API prints wears it. The specs' text extraction moves to
common/pdf/pdf.test-helpers.ts.

The extraction no longer accepts \r\n before endstream: PDFKit always
writes a bare \n, and the optional \r ate the last byte of a compressed
stream ending in 0x0D, which made inflate fail at random.

* feat(recettes): lot 2 work in progress

Work in progress on Recettes lot 2, carried over in one commit from the
working tree of 2026-11-02:
- migrations (not applied): recipe equipment, typed steps, allergen
  verification, recipe versions, half portions, catalog ingredients,
  recipe classification, dish variants;
- new ingredients module (catalogue);
- dishes: classification rules, duplication, recipe sheet PDF, and the
  rules, views and routes those migrations need;
- platform settings: recipe lists;
- follow-ups in allergies, bookings, catalog, referentials, shopping
  lists and R2 storage.

* feat(payments): payment_invoices table for invoice A

One invoice per card payment (unique on payment_id), numbered with a
unique invoice_number. The row exists before its PDF: snapshot freezes
everything the PDF is drawn from, so a failed upload is redrawn
identically; storage_path stays null until the file is stored.

Idempotent migration, not applied. No backfill: an invoice invented
after the fact for a past payment would be a false document.

* feat(payments): draw invoice A as a branded PDF

PDF/A-3b in the batchcooking identity, like the SEPA mandate: number,
issue and payment dates, the chef (with their SAP number when declared),
the client, the prestation, the lines and the total paid. Drawn only from
the frozen snapshot. Amounts are formatted by hand: Intl narrow no-break
spaces are missing from the embedded face.

* feat(payments): the chef is merchant of record on card payments

Card PaymentIntents, direct and through Checkout, now carry on_behalf_of
the chef's connected account, beside the unchanged destination charge and
application fee: the step decided on 2026-09-05 so invoice A can be issued
in the chef's name. The commission debit still never carries it.

Intents already open before this change are reused as they are, without
on_behalf_of.

* feat(payments): issue invoice A on card payment and serve it to the client

On payment_intent.succeeded, once the payment is settled and its
commission collected, invoice A is numbered in the same transaction: a
settled card payment always has its invoice. Its PDF is then drawn and
stored in the private Supabase bucket SUPABASE_INVOICES_BUCKET
(labsfood-invoices). A storage failure is logged
(payment_invoice.archive_failed), never thrown: the next download redraws
the PDF from the frozen snapshot and stores it.

Two routes for the order and document spaces:
- GET /me/payment-invoices (?bookingId= for one order), newest first;
- GET /me/payment-invoices/:id/download-url, a 5-minute signed link.
A client sees the invoices addressed to them, a chef those issued for
them; anyone else's answers 404 INVOICE_NOT_FOUND.

New settings: SUPABASE_INVOICES_BUCKET, PAYMENTS_INVOICE_PREFIX (LF-FAC).
CESU and URSSAF payments get no invoice A yet.
* **bookings:** booking a menu now requires declared allergies; every existing
client has to declare before their next menu (LF-0221).
* **allergies:** PATCH /me/profile and PATCH /admin/clients/{id} refuse
`allergies` (400). GET /admin/clients rows no longer carry allergies nor
customAllergies. The booking detail's `allergies` are French labels.

Migration 20261102100000_client_allergies moves the existing free text, word for
word, into custom_allergies, in place of the mapping script LF-0207 planned. It is
written, not applied.
* **dishes:** the dishes returned by GET /menus/week, GET /chefs/{id} and
GET /chefs/{id}/showcase no longer have prepMinutes, cookMinutes or calories. Read them
from the chef and admin routes, which still return them.

### Features

* **allergies:** clients declare their allergies with consent, or none ([206738b](https://github.com/LabsFood/LF-BackEnd/commit/206738b7537f444a3eedab2723fb173256df81da))
* **allergies:** re-check upcoming menus when the client's allergies change ([92f9a58](https://github.com/LabsFood/LF-BackEnd/commit/92f9a5869b797f6e184d096db81307e3ebb217ba))
* **bookings:** refuse a menu the client's allergies do not clear ([e9fc26b](https://github.com/LabsFood/LF-BackEnd/commit/e9fc26b149267ce85b1e2e1e8cd3a525f2444584))
* **bookings:** replace a dish in conflict with the client's allergies ([cd826a7](https://github.com/LabsFood/LF-BackEnd/commit/cd826a768cd0b09607ae6459d9d8e736acdeebec))
* **dishes:** add Recettes reason codes and hide times and calories on the storefront ([6daf5de](https://github.com/LabsFood/LF-BackEnd/commit/6daf5de90f9b77e44b1c8e4e13de3109a0a557af))
* **notifications:** add the in-app notification feed ([0a76385](https://github.com/LabsFood/LF-BackEnd/commit/0a763851a34400c8e5d917ad563b0351f9629aee))
* **observability:** report error logs to Sentry ([#78](https://github.com/LabsFood/LF-BackEnd/issues/78)) ([bba6105](https://github.com/LabsFood/LF-BackEnd/commit/bba6105aa4b04d4024e5c807c0c008d7ea4e5364))
* **payments:** draw invoice A as a branded PDF ([cb63f8e](https://github.com/LabsFood/LF-BackEnd/commit/cb63f8e1a7e25783a1d57a9e475286a82585d782))
* **payments:** issue invoice A on card payment and serve it to the client ([5b8963f](https://github.com/LabsFood/LF-BackEnd/commit/5b8963ff204c98e710f6e839abb573bbd7a3e225))
* **payments:** LF-CUSYY-XXXXX numbering and backfill of invoice A ([#77](https://github.com/LabsFood/LF-BackEnd/issues/77)) ([9cdd778](https://github.com/LabsFood/LF-BackEnd/commit/9cdd77841748dc46f99bd796a95f4cadc8759ac3))
* **payments:** payment_invoices table for invoice A ([b88002c](https://github.com/LabsFood/LF-BackEnd/commit/b88002cd7e22b63f71840beb93e21d18e58a319b))
* **payments:** rules for the lines and number of invoice A ([a5a3425](https://github.com/LabsFood/LF-BackEnd/commit/a5a34252893e07c1aee1a42cad767c6d1eb9dffc))
* **payments:** the chef is merchant of record on card payments ([a40b95e](https://github.com/LabsFood/LF-BackEnd/commit/a40b95ea1f70ca980e61350b629318cf223f54f9))
* **recettes:** lot 2 work in progress ([574be4e](https://github.com/LabsFood/LF-BackEnd/commit/574be4e605d49238287db98cccd00eef133b9c33))
* **shopping-lists:** the client answers the shopping list until noon the day before ([4246933](https://github.com/LabsFood/LF-BackEnd/commit/42469336beb7ec48d0029174a43a3239e06079cb))
* **users:** add four chef tiers with admin-editable names ([17fdb10](https://github.com/LabsFood/LF-BackEnd/commit/17fdb105db11893231c79394c4bc1c2e8bf204be))

### Bug Fixes

* **notifications:** replace the unused legacy notifications table ([87846bd](https://github.com/LabsFood/LF-BackEnd/commit/87846bdfae5affbddeb8787c739349f9466f2ebe))

### Miscellaneous Chores

* promote develop to main for the Recettes, invoice A and Sentry release ([#79](https://github.com/LabsFood/LF-BackEnd/issues/79)) ([f92911f](https://github.com/LabsFood/LF-BackEnd/commit/f92911fe400d13393b449e3156dbc86a4ae628ae)), closes [#77](https://github.com/LabsFood/LF-BackEnd/issues/77) [#78](https://github.com/LabsFood/LF-BackEnd/issues/78)

## [1.5.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.4.0...v1.5.0) (2026-11-02)

### Features

* integrate geo.api.gouv.fr for address validation across modules ([427dd75](https://github.com/LabsFood/LF-BackEnd/commit/427dd75190ac4701b173e2a1ddde03309efd2ca9))
* **users:** add listUsers endpoint for admin to retrieve user accounts ([070b2f8](https://github.com/LabsFood/LF-BackEnd/commit/070b2f88c8ea7a22253f923a9009fc21436e580a))

### Bug Fixes

* **tls:** distrust eMudhra (emSign) root CAs ([164a4cb](https://github.com/LabsFood/LF-BackEnd/commit/164a4cb95b398f2e5554ae1b7daec11dd17af967))

## [1.4.0](https://github.com/LabsFood/LF-BackEnd/compare/v1.3.0...v1.4.0) (2026-10-31)

### Features

* add service offers management with shopping options and fees ([dc052f8](https://github.com/LabsFood/LF-BackEnd/commit/dc052f81f836b2db9ba73934c4b32d2a3ec678a3))
* **admin:** list and read every batch cooker (LF-0164) ([27b3bd3](https://github.com/LabsFood/LF-BackEnd/commit/27b3bd3a7832288b49f47787675234b13b706ee7))
* **bookings:** add endpoint to list user's bookings with pagination ([3448da2](https://github.com/LabsFood/LF-BackEnd/commit/3448da2c26396c217f843430990f35c268b014a0))
* **bookings:** add support for booking supplements including extra meals and persons ([60ec84e](https://github.com/LabsFood/LF-BackEnd/commit/60ec84edfe00f67956a15714741c5d0c73af1e8e))
* **bookings:** enhance booking data structure with meal details in booking list and examples ([153dfe8](https://github.com/LabsFood/LF-BackEnd/commit/153dfe841de8e6ad000b51469bc7ea3e3584c381))
* **bookings:** implement booking status transitions and earnings calculations ([c9241e2](https://github.com/LabsFood/LF-BackEnd/commit/c9241e21c58296ebca782bd3ea790904a33afe24))
* **bookings:** update conflict responses to reflect chef availability status ([3e76cde](https://github.com/LabsFood/LF-BackEnd/commit/3e76cde86104d7e4de4201a84eed2056f62f377f))
* **calendar:** add calendar module with availability and connection services ([cdda46d](https://github.com/LabsFood/LF-BackEnd/commit/cdda46d8d5e12b141e328d2a535c7b67c7c16a27))
* **calendar:** agenda, calendar feed, rescheduling and a temporary disputed status ([99b09b1](https://github.com/LabsFood/LF-BackEnd/commit/99b09b1b7bb19575414db31f97a3671c4245df96))
* **catalog:** give meals an owner and an author ([2308499](https://github.com/LabsFood/LF-BackEnd/commit/2308499f4a9975e05e05c61221b9b1783129bb87))
* **chef-onboarding:** admin candidature list and detail return isActive ([7aa9ec3](https://github.com/LabsFood/LF-BackEnd/commit/7aa9ec3568a80c6ab535f87d9bea6f66825b7dca))
* **chef-onboarding:** candidature, KYC and admin validation (FLOW-01) ([46a3b8e](https://github.com/LabsFood/LF-BackEnd/commit/46a3b8e15a177fbe37c04cf4c9f3d35a1a3e6298))
* **chef-onboarding:** create the account at candidature submission ([20107f9](https://github.com/LabsFood/LF-BackEnd/commit/20107f9d7681a11fde0644c6adea2ff196ef20c4))
* **chef-onboarding:** lift automatic suspension on deposit, not on review ([36f26d1](https://github.com/LabsFood/LF-BackEnd/commit/36f26d17e684e437e8f6dd24fbca812e77efb5d4))
* **chef:** add languages support for chef profiles and update related endpoints ([8249eca](https://github.com/LabsFood/LF-BackEnd/commit/8249eca28f3f93688aa0303d4457539b20e0b07e))
* **ci:** add CI workflow for quality checks and security audits ([631c0ae](https://github.com/LabsFood/LF-BackEnd/commit/631c0ae5530028f4af870a6e8c3b243f92dcf040))
* **contact:** public contact forms and their admin inbox ([fa7acec](https://github.com/LabsFood/LF-BackEnd/commit/fa7acec59c8ff83b8fb0f6bb9e424be220a71214))
* **dishes:** a prestation leaves its recipe sheet and shopping list ([32ec358](https://github.com/LabsFood/LF-BackEnd/commit/32ec358c190ac8863edb678a290e6329458be512))
* **dishes:** dish photos on Cloudflare R2 ([34789d0](https://github.com/LabsFood/LF-BackEnd/commit/34789d0247a4ad0509e74cb4d18cdf1ad2d353d9))
* **dishes:** enhance dish and menu representations with chef details and usage metrics ([22a9c01](https://github.com/LabsFood/LF-BackEnd/commit/22a9c01393b039b2670f77658927213cac5556e8))
* **dishes:** Lab's Food suggestions, adoption and offers ([ed89543](https://github.com/LabsFood/LF-BackEnd/commit/ed89543398c2b1ff1a874fa3fad81e2f90511971))
* **dishes:** let a batch cooker compose, publish and schedule menus ([a79fe83](https://github.com/LabsFood/LF-BackEnd/commit/a79fe83fdd3a484dcbeec124ac27d53ec1f9b655))
* **dishes:** let a batch cooker write and publish their own dishes ([83f797d](https://github.com/LabsFood/LF-BackEnd/commit/83f797d1fdf0c5a40f6a8745bc023e6444463dcc))
* **dishes:** moderation after the fact ([8e1316e](https://github.com/LabsFood/LF-BackEnd/commit/8e1316e2cd0f00e7484d1961facda667cbc710d8))
* **dishes:** the public page lists cooks, not dishes ([d9fd0d2](https://github.com/LabsFood/LF-BackEnd/commit/d9fd0d29dce09dbc4ea99a98ade6a07592a1ac2c))
* **earnings:** add collectedNetCents to track actual received amounts ([72b8ef3](https://github.com/LabsFood/LF-BackEnd/commit/72b8ef310d65911d9daee0ade9c4c44bd4d2fa2c))
* enhance dish and payment features with CESU support and improved API responses ([017ebed](https://github.com/LabsFood/LF-BackEnd/commit/017ebed66a255d6823a795a03c6720c77a52d8cb))
* enhance documentation and implement missingDocuments count in chef applications ([#54](https://github.com/LabsFood/LF-BackEnd/issues/54)) ([cf2f8dd](https://github.com/LabsFood/LF-BackEnd/commit/cf2f8dd86f19f58f589fc9abf224e66280c24f06))
* implement account deletion functionality with admin and user roles ([56c1d93](https://github.com/LabsFood/LF-BackEnd/commit/56c1d93458ddc45df2a147c30d783340e9e6cbe3))
* implement CORS allow PATCH,PUT,DELETE ([e7927e8](https://github.com/LabsFood/LF-BackEnd/commit/e7927e897f37b30295d2459b9c75f22412596d18))
* implement user avatar management and update related services ([9cd88f4](https://github.com/LabsFood/LF-BackEnd/commit/9cd88f49ae0b856c427d2f56d327dbd9607ed642))
* **logging:** ensure JSON response type for AllExceptionsFilter ([9453055](https://github.com/LabsFood/LF-BackEnd/commit/9453055791213841a2b4d7a5fd4cfa72ea9524a1))
* **menu-weeks:** implement CRUD operations for weekly menus and update DTOs ([3f46278](https://github.com/LabsFood/LF-BackEnd/commit/3f462787570000486860bd7a2253b6ed7feb70b6))
* **messaging:** in-house conversations, realtime and attachments ([bfd39f6](https://github.com/LabsFood/LF-BackEnd/commit/bfd39f6269a368bd3fa34f3962aee3a51c7260a5))
* **payments:** add createDashboardLink for accessing Stripe Express dashboard ([2cba58b](https://github.com/LabsFood/LF-BackEnd/commit/2cba58b30d764082bafa174fdc61ef8be3e6edef))
* **payments:** bring the payment module onto develop ([5954401](https://github.com/LabsFood/LF-BackEnd/commit/595440113d55c668fa8a8b2264366b4e75adb269))
* **payments:** enhance commission debit handling with admin retry logic ([d541a31](https://github.com/LabsFood/LF-BackEnd/commit/d541a31b9819872719955a3c3624f15c24f3db7c))
* **payments:** enhance SEPA mandate PDF generation with embedded fonts and logo ([1d8906c](https://github.com/LabsFood/LF-BackEnd/commit/1d8906c761bb84771546db8b8c1fe6b5ac2df52a))
* **payments:** ensure only later signatures can replace active SEPA mandates ([67e5a95](https://github.com/LabsFood/LF-BackEnd/commit/67e5a95318f6508fc2aa476c327e4f15209a66f3))
* **payments:** implement Accounts v2 integration for Stripe, enhancing chef onboarding and payment processing ([4bd829c](https://github.com/LabsFood/LF-BackEnd/commit/4bd829ccc22bb066f6fe88f0108ee54ef92b16d0))
* **payments:** implement CESU pending handling and update payment methods ([ee57d87](https://github.com/LabsFood/LF-BackEnd/commit/ee57d87195011651ec6d8a3fc070417e60f1661f))
* **payments:** implement e-CESU proof handling and related functionality ([20ec006](https://github.com/LabsFood/LF-BackEnd/commit/20ec0065f2e6d2f6d1e446a27e047b843d98bd10))
* **payments:** implement SEPA mandate checkout and confirmation endpoints ([166e1d9](https://github.com/LabsFood/LF-BackEnd/commit/166e1d9c89750237885742c36f18d0768d056063))
* **payments:** pay a prestation after it took place, three ways (FLOW-03) ([a22fb83](https://github.com/LabsFood/LF-BackEnd/commit/a22fb83961e64092bda85c83d9ed277a78851b90))
* **payments:** payment options name the batch cooker ([ab7d27c](https://github.com/LabsFood/LF-BackEnd/commit/ab7d27cfb413e005dedc19f5f19f13fd616a5a76))
* **quotes:** custom requests, offers and the booking they create (BLK-10) ([57592f4](https://github.com/LabsFood/LF-BackEnd/commit/57592f47bbce9a5064cfff839171be91d0f4b76d))
* **release:** update release workflow to trigger on push to main and improve semantic-release handling ([3c775a7](https://github.com/LabsFood/LF-BackEnd/commit/3c775a77ab6d7dd91e7661996739ad6d6052b327))
* **sap:** add upsert functionality for SAP profile in chef application approval process ([389a3e5](https://github.com/LabsFood/LF-BackEnd/commit/389a3e590f5aed9f47923ed31af843612aab0f3e))
* **service-offers:** add admin endpoint to list all batch cooker's offers with chef details ([5ee2f8c](https://github.com/LabsFood/LF-BackEnd/commit/5ee2f8c841798b471333f1ff39b242c1efa9ff3a))
* **stats:** update dashboard and stats methods to include next booking and improved totals ([9fe2c14](https://github.com/LabsFood/LF-BackEnd/commit/9fe2c140e6508d41678ae772779485e66cf1c141))
* **users:** add endpoint to export user data with auditing and compliance ([74be7d7](https://github.com/LabsFood/LF-BackEnd/commit/74be7d7e25ddb4a9f7d9d7c7ec85dd015a878366))
* **users:** enhance client profile update with auditing and status validation ([e997da3](https://github.com/LabsFood/LF-BackEnd/commit/e997da325b90133c285e34f348bcea37cb4cb685))
* **users:** enhance SAP status update with auditing and error handling ([4caf940](https://github.com/LabsFood/LF-BackEnd/commit/4caf940d48391c288db02fda1eab0468e028b826))
* **users:** restore chef self-edit as update-only PATCH /me/chef-profile ([defd04f](https://github.com/LabsFood/LF-BackEnd/commit/defd04f9ee912c75c389f96394d7c85eb696721b))

### Bug Fixes

* **clerk-webhooks:** stop retrying a user deletion that bookings block ([f0fcba5](https://github.com/LabsFood/LF-BackEnd/commit/f0fcba5f9fda11be7cca51a642ffd52752f1f7f6))
* **deps:** bump prisma, @prisma/client and @prisma/adapter-pg to 7.10.1 ([d46a912](https://github.com/LabsFood/LF-BackEnd/commit/d46a91295d18894d26f9a2f1f3b086c8f835319e))
* **deps:** override js-yaml to ^5.4.1 under @nestjs/swagger ([e057590](https://github.com/LabsFood/LF-BackEnd/commit/e057590d1dc68a441e4b5d147ab6cb258650b40d))
* **husky:** the pre-commit hook runs on Windows ([d389e35](https://github.com/LabsFood/LF-BackEnd/commit/d389e35713785b0fcee1194e3975fca04400b8cf))
* **migrations:** the avatar migration applies on a fresh database ([5214357](https://github.com/LabsFood/LF-BackEnd/commit/521435758e6b261134996b436134c8fd7a351215))
* **payments:** tie the URSSAF simulation guard to live Stripe keys ([678321e](https://github.com/LabsFood/LF-BackEnd/commit/678321eee29f0f3242f82cfbbf6cdef14dcdb7bc))
* **quotes:** never trust what a form sends ([6dec812](https://github.com/LabsFood/LF-BackEnd/commit/6dec812b1b0b76b85a6359bfd32b4ba584c53eac))
* **r2-storage:** adjust requestChecksumCalculation for presigned PUT compatibility ([b945837](https://github.com/LabsFood/LF-BackEnd/commit/b945837e2e58a87fae9c97b5ccbc9ae0c03f00fa))
* **r2-storage:** update R2 endpoint to use EU region for compatibility ([9cb940a](https://github.com/LabsFood/LF-BackEnd/commit/9cb940aeb6705f7c31ece6efcfbaf7138007de82))
* restrict GET /bookings to admins ([#39](https://github.com/LabsFood/LF-BackEnd/issues/39)) ([7561562](https://github.com/LabsFood/LF-BackEnd/commit/75615627f2ebe12db156df7c72bd36ae5caa8046))
* **security:** harden the Node runtime and Supabase connections ([#61](https://github.com/LabsFood/LF-BackEnd/issues/61)) ([709c06c](https://github.com/LabsFood/LF-BackEnd/commit/709c06cd383e0b236c3406cd36cc02fd7521eac6))
* **users:** anonymise a deleted account its bookings still reference ([7fb48a4](https://github.com/LabsFood/LF-BackEnd/commit/7fb48a43abf46bc5792e92544f47f60730da7361))
