# Rapport d'audit sécurité — LF-BackEnd — 2026-11-20 (run complet)

> Diff vs baseline `docs/security/audit-securite-plan.md` (2026-10-20, `b370f11`) et vs le run `--quick` du 2026-10-24.
> État audité : `develop` @ `69be1dd` (merge #103). Lecture seule : aucune écriture DB ou prod, aucun test dynamique exécuté, rien de commité.
> Périmètre : `apps/src/**`. Depuis la baseline : **112 routes nouvelles**, 0 supprimée (238 → 350 routes).

## Résultat

**Les deux cibles critiques de la baseline sont fermées** par `0d8b02d` (« launch readiness, security fixes », #85). Il ne reste aucun ⚫ ni 🔴.
Aucune régression BOLA/BFLA sur les 112 nouvelles routes. Restent des 🟠 : défense en profondeur et deux écarts de logique métier.

| Cible | Baseline | Aujourd'hui | Diff |
|---|---|---|---|
| ⚫ 1 — fallback JWT non vérifié | ⚫ | 🟠 résiduel | **RÉSOLU** |
| 🔴 3 — `trustProxy: true` + throttler non global | 🔴 | 🟠 résiduel | **RÉSOLU** |
| 🟠 2 — BOLA (anti-régression) | 🟠 | 🟠 | **INCHANGÉ** : toujours aucune vuln active, toujours pas de `ChefGuard` |

---

## 1. Diff vs baseline, item par item

### ⚫ Cible 1 — vérification des JWT Clerk → RÉSOLU (reste un 🟠)
- `shouldVerifyClerkJwt` est maintenant **fail-closed** (`auth/clerk-auth.guard.ts:115-118`). Une signature n'est pas vérifiée **que** si `ENVIRONMENT=test`, ou si `ENVIRONMENT=development` **et** la clé vaut le stub `sk_test_placeholder`. Une clé absente donne 503. Une clé malformée sur un env déployé fait refuser tous les jetons au lieu de les accepter.
- `ENVIRONMENT=staging` est refusé au démarrage, staging ayant été retiré (`config/env.validation.ts:6-9`). La question « étendre le contrôle à staging » ne se pose plus.
- La WebSocket de la messagerie passe par le même `resolveClerkUser`. `authorizedParties` = origines CORS.
- 🟠 **Résiduel (NOUVEAU)** : le fallback reste atteignable par **mauvaise configuration** d'un env déployé :
  - `ENVIRONMENT=test` est accepté par Joi sur n'importe quel hôte ;
  - `ENVIRONMENT` absent prend la valeur par défaut `development`. Avec `CLERK_SECRET_KEY=sk_test_placeholder` (copie de `.env.example`), aucune signature n'est vérifiée. Au démarrage, `main.ts:89-99` émet un **warn**, mais rien n'est bloqué.
  - *Correctif proposé* : refuser au démarrage `test` hors Jest (`JEST_WORKER_ID` absent) et le stub dès qu'une variable Railway est présente (`RAILWAY_ENVIRONMENT`). Les deux scénarios deviennent alors des crashs plutôt que des contournements silencieux.

### 🔴 Cible 3 — proxy de confiance et rate limiting → RÉSOLU (reste un 🟠)
- `trustProxy: trustRailwayEdge` = `hop === 0` (`config/trusted-proxy.ts`, `main.ts:80`). Seul le bord Railway est cru, si bien que `req.ip` est la dernière entrée de `X-Forwarded-For` ajoutée par le bord. Un client ne peut plus choisir son propre bucket.
- `APP_GUARD` = `GlobalThrottlerGuard`, 300 req/min/IP sur toutes les routes HTTP (`app.module.ts:106`, `common/throttling/global-throttler.guard.ts`). Exemptions : `@SkipThrottle({ global: true })` sur les webhooks Clerk/Stripe et sur `/health`. Les limites serrées `register` (5/h) et `payments` (20/min) restent sur les routes concernées.
- 🟠 **Résiduels** :
  - le stockage est **en mémoire, par réplica**, donc la limite réelle vaut `limit × réplicas` (develop a 2 réplicas). Pour `register` (5/h), cela fait 10/h sur develop. Passer sur Redis si cela compte (`REDIS_URL` existe déjà) ;
  - le calcul `hop === 0` suppose qu'aucun proxy n'est placé devant Railway. Un domaine proxifié par Cloudflare mettrait tous les clients dans le bucket de l'IP Cloudflare, et un seul client pourrait bloquer `register` pour tout le monde. Le commentaire du code le dit ; à garder dans la checklist ops ;
  - *(fonctionnel, pas sécu, à confirmer)* : le `ThrottlerGuard` standard posé sur une route évalue **tous** les throttlers nommés qui ne sont pas skippés. Les routes publiques qui ne surchargent que `register` (vitrine 60/min, disponibilités 30/min, contact, calendar feed) restent donc aussi soumises à `payments` (20/min par défaut).

### 🟠 Cible 2 — BOLA / BFLA → INCHANGÉ, aucune régression
Les 112 nouvelles routes ont été tracées jusqu'au prédicat de propriété :

| Famille de routes | Résolution du propriétaire | Verdict |
|---|---|---|
| `/me/bookings/:id/{card,card/confirm}` | `ownRequest` → `findFirst({ id, clientId })` ; `sessionId` comparé à `booking.cardSetupSessionId` | ✅ |
| `/me/bookings/:id/{consents,meals/replace}`, `/chef/bookings/:id/meals/replace` | `caller()` + `scope()` | ✅ |
| `/me/bookings/:id/{withdrawal,documents/:kind}` | `findFirst({ id, clientId })` | ✅ |
| `/chef/bookings/:id/{accept,refuse}` | `chefIdentity` → `chefRequest({ id, chefProfileId })` | ✅ |
| `/me/bookings/:id/groceries/*`, `/chef-missions/:id/groceries/*` | `GroceriesService.access()`/`as(role)` : rôle déduit de la propriété (`clientId` / `chefProfile.userId`) ou `users.role=admin`, sinon 404 ; `confirmCard` lié à `run.stripeSetupIntentId` | ✅ |
| `/chef-missions/:id/{notes,eat-before,conservation(.pdf),shopping-list/*}`, `/me/bookings/:id/shopping-list/submit` | `MissionsService.access()`/`asChef`/`asClient` | ✅ |
| `/me/dishes/:id/{versions*,recipe.pdf,duplicate,allergens/confirm}`, `/me/menus/:id/duplicate` | `ChefContentService.readable*/writable*` (`chefProfileId === chef.id`) + `assertVerified` sur les écritures | ✅ |
| `/me/chef/ingredients/:id`, `/me/ingredients/:id` | `ownVersion({ id, chefProfileId })` ; entrée en attente : `chefProfileId`/`createdByUserId` | ✅ |
| `/me/express-dishes/:id/decision` | `findFirst({ id, chefProfileId })` | ✅ |
| `/me/payment-invoices/:id/download-url` | `findFirst({ id, ...ownedBy(user.id) })` | ✅ |
| `/me/notifications/:id/read` | `where: { id, userId }` | ✅ |
| `/me/urssaf-dossier`, `/me/export` | propriétaire implicite (pas d'id) ; export audité | ✅ |
| 133 routes `/admin/**` | `ClerkAuthGuard + AdminGuard` sur toutes, **sauf 2** (voir ci-dessous) | ✅ |

Nouvelles routes **publiques** depuis la baseline, toutes jugées acceptables :
- `/referentials/{languages,units,step-types,computed-diets,regions/:code/communes,aisles,recipe-profiles,reheat-modes}` : référentiels statiques ou de configuration.
- `GET /chefs/:id/payment-methods` : 3 booléens, uniquement pour un chef `isActive && isVerified`.
- `GET /chefs` (vitrine) : `PUBLIC_CHEF_FIELDS` (nom affiché, ville, bio, zones, langues, avatar, NAN CRCESU), sans email, téléphone ni adresse.
- `POST /webhooks/brevo` : jeton partagé, fail-closed (voir § 2).

#### 🟠 NOUVEAU — invariants de défense en profondeur cassés (pas de vuln active)
1. **Routes `admin/...` sans `AdminGuard`** : `GET admin/bookings/:id/groceries` et `GET admin/bookings/:id/groceries/receipts/:receiptId/url` sont déclarées par un `@Get([...])` à 3 chemins sur un contrôleur qui n'a que `ClerkAuthGuard` (`groceries/groceries.controller.ts:62-66` et `:213-217`). Elles sont sûres aujourd'hui, car `access()` relit le rôle en base. Mais la règle « toute route admin porte `AdminGuard` » ne se vérifie plus par grep, et une future route du même tableau n'aurait aucune garde de rôle. *Correctif* : sortir les chemins `admin/` dans le contrôleur `AdminGuard` voisin (l. 310-311).
2. **Nouveau contrôleur à gardes méthode par méthode** : `ingredients/ingredients.controller.ts` (classe l. 112 sans `@UseGuards`, 12 routes admin et 4 routes chef gardées une par une). C'est exactement le schéma « un décorateur oublié = route publique » que la baseline signalait. Toutes les routes sont gardées aujourd'hui.
3. **Accès chef hors `chefIdentity`** : `GroceriesService.access()` et `MissionsService.access()` reconnaissent le chef par la propriété du booking, sans contrôle `isVerified` ni `isActive`. Les lectures de `ChefContentService` ne passent pas par `assertVerified`, ce qui est documenté (« reads not marked stay open »).

→ Ces trois points renforcent la recommandation de la baseline : `ClerkAuthGuard` en `APP_GUARD` avec opt-out `@Public()`, plus un `ChefGuard`.

### 🟠 Autres items de la baseline
| Item | État | Diff |
|---|---|---|
| Pas d'`APP_GUARD` global d'**auth** | seul le throttler est global ; `ClerkAuthGuard` reste posé à la main | **INCHANGÉ** (aggravé par les points 1 et 2 ci-dessus) |
| Swagger `/docs` + `/openapi.json` exposés | `SwaggerModule.setup` inconditionnel (`main.ts:134`) | **INCHANGÉ** |
| Secrets webhook `allow('')` en prod | `CLERK_WEBHOOK_SIGNING_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` toujours optionnels (`env.validation.ts:41,54,60`) ; au runtime, fail-closed 503 | **INCHANGÉ** |
| CSP off | `helmet({ contentSecurityPolicy: false })` (`main.ts:106-108`) | **INCHANGÉ** |

---

## 2. Nouveaux constats hors cibles

### 🟠 Logique métier — un chef suspendu peut encore agir sur ses prestations (à confirmer côté produit)
La suspension automatique (documents expirés, `chef-dossier.cron.ts:160`) pose `isActive=false, autoSuspendedAt` mais **garde `isVerified=true`** (`admin-chefs.service.ts:108`). Or `chefIdentity` ne teste que `isVerified` (`users.service.ts:185-206`). Un chef suspendu, par exemple pour assurance ou pièce d'identité expirée, peut donc encore :
- **accepter** une demande en attente dans sa fenêtre de 48 h (`booking-requests.service.ts:235`), ce qui confirme une prestation et déclenche le débit après la séance ;
- faire avancer ses bookings et ses courses.

La vitrine et `payment-methods` filtrent bien sur `isActive`. Il faut décider si la suspension doit bloquer `accept` (et la création de nouveaux engagements). Si oui : ajouter `isActive` dans `chefIdentity` ou dans `chefRequest`.

### 🟠 Webhook Brevo — jeton dans l'URL, comparaison non constante
`POST /webhooks/brevo?token=…` (`groceries.controller.ts:415-422`) est fail-closed (403 sans `BREVO_WEBHOOK_TOKEN`, ≥ 24 caractères) et ne sert qu'à horodater la livraison d'un email (`updateMany` sur `emailMessageId`). Faible impact. Deux points :
- `token !== expected` : utiliser `crypto.timingSafeEqual` ;
- le jeton voyage dans la query string. Les access logs la retirent (`main.ts:64-71`), mais elle peut apparaître côté Brevo, dans les logs du bord Railway ou dans les traces Sentry. Le faire tourner s'il fuit. Le jeton n'apparaît pas dans ce rapport.

### 🟢 Sains, vus dans le diff (ne pas casser)
- **Débit après la séance (CGV V1)** : montant recalculé côté serveur (`bookingCoverage(...).remainingAmountCents`, `payments.service.ts:208`), clé d'idempotence par ligne de paiement, réclamation atomique `autoChargedAt` (`booking-requests.service.ts:507-511`) : pas de double débit.
- **Courses** : budget plafonné par les réglages console, empreinte `capture_method: manual` (la capture ne peut pas dépasser l'autorisation), idempotence `grocery-hold-${paymentId}`.
- **Open redirect Stripe** : tous les `success_url`/`cancel_url` fournis par le client passent par `assertOwnSiteUrl` (origine dans l'allowlist CORS). C'est le cas pour les paiements, la carte du booking, la carte des courses et le mandat SEPA.
- **Transitions de booking** : matrice `MOVES` stricte (`domain/booking-status.ts`) ; `pending→completed` impossible hors admin ; annulation refusée si un paiement existe.
- **Injections** : 0 `$queryRawUnsafe`/`$executeRawUnsafe`/`Prisma.raw`. Les 2 `FOR UPDATE` utilisent le template tag paramétré.
- **`ValidationPipe`** : `whitelist + forbidNonWhitelisted + transform` (`main.ts:118-124`).
- **`URSSAF_GATEWAY=simulated`** interdit avec `sk_live_` (`env.validation.ts:99-107`). Le mode `manual` exige `KYC_ENCRYPTION_KEY` (AES-256). La consultation admin d'un dossier URSSAF est auditée (`urssaf-dossiers.service.ts`, `reveal`).
- **Commission** : `PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS` borné 1-10.
- **Secrets** : seuls `.env.example` et `local-dev/.env.example` sont versionnés ; `.gitignore` couvre `.env` et `.env.*` ; 0 secret en dur (le seul hit est la regex `^sk_live_` de `env.validation.ts`). `apps/certs/supabase-prod-ca-2021.crt` est une CA publique.
- **Webhooks Clerk/Stripe** : signature vérifiée (`verifyWebhook` / `constructEvent`), 503 si le secret manque.
- **RGPD** : `GET /me/export` (art. 15/20) scopé à l'appelant et audité.

---

## 3. Bilan ⚫🔴🟠

- ⚫ **NOIR** : aucun (Cible 1 résolue).
- 🔴 **ROUGE** : aucun (Cible 3 résolue).
- 🟠 **ORANGE**, par priorité :
  1. Suspension chef non prise en compte par `chefIdentity` / `accept` *(logique métier, NOUVEAU)*.
  2. Pas d'`APP_GUARD` d'auth global ni de `ChefGuard` ; 2 routes `admin/` sans `AdminGuard` ; nouveau contrôleur à gardes méthode par méthode *(défense en profondeur, NOUVEAU + INCHANGÉ)*.
  3. Fallback JWT atteignable par mauvaise config (`ENVIRONMENT=test`, ou défaut `development` + stub) *(résiduel Cible 1)*.
  4. Throttler en mémoire par réplica ; hypothèse « aucun proxy devant Railway » *(résiduel Cible 3)*.
  5. Swagger exposé ; secrets webhook `allow('')` ; CSP off *(INCHANGÉS)*.
  6. Webhook Brevo : comparaison non constante, jeton en query *(NOUVEAU, faible)*.

### Mapping réglementaire
| Item | OWASP API Top 10 (2023) | CNIL |
|---|---|---|
| Cible 1 (résolue ; résiduel config) | API2 Broken Authentication, API8 Security Misconfiguration | art. 32 RGPD ; Fiche 25 (authentification des API) |
| Cible 3 (résolue ; résiduel réplicas) | API4 Unrestricted Resource Consumption | art. 32 ; sanction credential stuffing du 27/01/2021 (150 k€ + 75 k€) |
| Cible 2 / gardes admin / `ChefGuard` | API1 BOLA, API5 BFLA | Fiche 25 (contrôle d'accès par ressource) |
| Suspension chef | API6 Unrestricted Access to Sensitive Business Flows | art. 32 (mesures organisationnelles) |
| Swagger, CSP, secrets optionnels | API8 Security Misconfiguration, API9 Improper Inventory Management | Fiche 25 |

---

## 4. Checklist tests dynamiques (humain, **env de test uniquement**, jamais de clés `sk_live_`)

- [ ] **Cible 1** : JWT à signature bidon → **401** sur develop et en prod. Puis, sur une instance locale lancée avec `ENVIRONMENT=test` et une vraie clé, vérifier que le correctif proposé fait **échouer le démarrage**.
- [ ] **Cible 3** : dépasser `register` (5/h) en faisant tourner `X-Forwarded-For` → la limite tient. Dépasser 300 req/min sur une route `/me/*` → 429. Vérifier que `/webhooks/stripe` et `/health` ne sont jamais throttlés.
- [ ] **BOLA** : le compte B rejoue les UUID de A sur `GET /me/bookings/:id`, `/documents/contract`, `/groceries`, `/groceries/receipts/:rid/url`, `POST /me/bookings/:id/{card,withdrawal,consents}`, `/quotes/:id`, `/me/conversations/:id`, `/me/payment-invoices/:id/download-url`, `/me/notifications/:id/read`, `fiscal-attestations`, `calendar.ics` → **404**.
- [ ] **BOLA chef** : le chef B rejoue sur `/chef/bookings/:id/accept`, `/chef-missions/:id/{conservation,groceries/receipts/upload-url}`, `/me/dishes/:id/{versions,recipe.pdf,duplicate}`, `/me/chef/ingredients/:id` → 404 (ou 403 `CONTENT_NOT_OWNED`).
- [ ] **BFLA** : un client appelle `chef/*` → `NOT_A_CHEF` ; un chef non vérifié → `CHEF_NOT_VERIFIED`. Un client appelle `GET /admin/bookings/:id/groceries` sur **son propre** booking → il doit recevoir la vue client, sans aucun champ admin.
- [ ] **Suspension** : chef auto-suspendu (`isActive=false`) avec une demande en attente → `POST /chef/bookings/:id/accept`. Noter le résultat (aujourd'hui : accepté) et décider.
- [ ] **Logique paiement** : envoyer un `amount` dans le body d'un paiement → 400 (`forbidNonWhitelisted`) ou ignoré. Le débit après séance est égal au restant dû serveur. Rejouer le cron de débit → un seul PaymentIntent.
- [ ] **Open redirect** : `successUrl=https://evil.example` sur `/me/bookings/:id/card`, `/groceries/card` et le checkout SEPA → 422 `RETURN_URL_NOT_ALLOWED`.
- [ ] **Brevo** : `POST /webhooks/brevo` sans jeton ou avec un mauvais jeton → 403.

### ⚠️ Ops (hors code)
- Vérifier sur Railway (develop et production) : `ENVIRONMENT` explicitement posé, `CLERK_SECRET_KEY` réelle, les 3 secrets webhook et `BREVO_WEBHOOK_TOKEN` présents.
- Aucun proxy (Cloudflare proxifié) devant le domaine de l'API tant que `trustRailwayEdge` vaut `hop === 0`.

---

## 5. Veille vulnérabilités (Phase 4bis), 2026-11-20

> Inventaire tiré de `apps/package-lock.json`, `apps/Dockerfile`, `.nvmrc` et `ops/db-backup/Dockerfile`. Rien n'a été mis à jour.
> **Scanners** : `npm audit --omit=dev` donne **0** vulnérabilité, tous niveaux. **OSV (api.osv.dev) n'a pas pu tourner** : l'hôte est refusé par le proxy réseau de la session. Trivy n'est pas disponible : le scan d'image reste à faire (checklist).
> `npm audit` ne signale pas les deux avis Fastify ci-dessous, alors que nos versions sont dans les plages annoncées par les agrégateurs. Ils ne sont donc pas encore dans GitHub Advisory, ou les plages publiées sont fausses. Ils sont marqués **à confirmer**.

### Concernent nos versions
| Avis | Composant | Chez nous | Corrigé | Applicable ? | Action |
|---|---|---|---|---|---|
| Release sécurité Node du 11/11/2026 : 16 CVE (7 hautes) en HTTP/2 et TLS, dont CVE-2026-123864 (fuite de mémoire HTTPS) et CVE-2026-123872 (contournement du certificat client en TLS 1.2) | Node.js (image `node:24.22.1-alpine3.24`, `.nvmrc`) | 24.22.1 | **24.22.3** | **Partiel** : l'API sert du HTTP/1.1 en clair derrière le bord Railway, qui termine TLS. Les failles côté serveur HTTPS/HTTP2 ne sont pas atteignables. Le client TLS sortant (Stripe, Clerk, Supabase, Brevo) est concerné selon le CVE. | 🟠 **Monter en 24.22.3** (Dockerfile ×4 `FROM`, `.nvmrc`, contrôle CI). Priorité la plus haute de cette liste. |
| CVE-2026-120216 (crash quand une réponse en streaming dépasse `handlerTimeout`), CVSS 5.9 | `fastify` | 5.12.7 | 5.12.8 | **Non** : aucun `handlerTimeout` configuré (grep vide), valeur par défaut 0. **À confirmer** (agrégateurs seulement) | 🟠 Monter en 5.12.8 au prochain lot de dépendances |
| CVE-2026-130811 (listing d'un dossier pointé refusé), CVSS 5.3 | `@fastify/static` (transitif, assets Swagger UI) | 10.1.10 | 10.1.12 | **Peu probable** : nécessite le listing de répertoires activé, que l'app ne configure pas. **À confirmer** | 🟠 Montée transitive avec Fastify / `@nestjs/swagger` |
| Alpine 3.24 : CVE-2026-95691 sur `openssl 3.5.9-r0` (statut non résolu au 17/11) | image de base Alpine 3.24 | non mesuré | inconnu | **À mesurer** : aucun avis Alpine trouvé, la version apk de l'image n'est pas lue ici | 🟠 Scanner l'image (Trivy / Docker Scout) puis reconstruire |

### Vérifiés, non concernés
| Avis | Composant | Chez nous | Pourquoi c'est OK |
|---|---|---|---|
| CVE-2026-111497 (Brotli, RCE exploitée activement) | Node.js | 24.22.1 | corrigé à partir de 24.22.1 |
| CVE-2026-84504 (substitution du body avec validateurs Ajv asynchrones) | fastify | 5.12.7 | corrigé en 5.12.2 |
| CVE-2026-33011 / CVE-2026-2293 (contournement de middleware par HEAD / normalisation de chemin), CVE-2026-35515 (XSS SSE), CVE-2026-40879 (DoS transport TCP), CVE-2026-54281 | NestJS | 11.1.28 | tous corrigés en ≤ 11.1.24 |
| CVE-2026-42349 (`has()` / `auth.protect()`), CVE-2026-34076 (SSRF `clerkFrontendApiProxy`) | `@clerk/backend` | 3.16.1 | corrigés en 3.2.14 et 3.2.3 ; l'API n'utilise ni `has()` ni le proxy. Le pré-avis AIKIDO-2026-125473 (2.33.0–3.11.6) est non confirmé et hors plage. |
| GHSA-7589-6fvf-x4pw (ReDoS dans `effect`, via `@prisma/config`) | effect | 3.22.5 | corrigé en 3.22.1 |
| CVE-2026-6460 et 51 autres (PostgreSQL, 12/11) | image db-backup | `postgres:17.12-alpine3.24` | 17.12 est la version corrigée, déjà déployée (#101) |
| idem | Postgres Supabase (géré) | non visible ici | **à vérifier** dans le dashboard Supabase (version mineure ≥ 17.12 ou correctif appliqué) |
| CVE-2026-123158 (OpenSSH « sshhole », KEV) | Alpine | — | pas de `sshd` dans les images |
| CVE-2020-7637 (pollution de prototype) | class-transformer | 0.5.1 | ≤ 0.2.3 seulement |
| Aucun avis 2026 trouvé | `stripe` 17.7.0, `ws` 8.22.0 / 8.21.2, `pdfkit` 0.20.2, `@supabase/supabase-js` 2.112.2, `@sentry/nestjs` 11.11.0, `@nestjs/throttler` 6.5.0, `class-validator` 0.14.4 | — | `@nestjs/throttler` 6.8.0 (16/11) corrige des bugs (`limit: 0` après blocage, `blockDuration: 0`), pas d'avis sécurité |

### Supply chain (campagnes récentes)
| Campagne | Dans le lockfile ? | Verdict |
|---|---|---|
| TanStack / Mini Shai-Hulud (11/05/2026, CVE-2026-45321) | `@tanstack/query-core` 5.101.4 (prod, orphelin : `npm ls` vide) | **Sain** : la famille `query*` est déclarée propre par le postmortem TanStack, et la version a été publiée le 21/07/2026, après l'incident. Paquet orphelin à retirer du lockfile (`npm prune`). |
| Shai-Hulud keyv / cacheable (résurgence du 15/11/2026) | `keyv` 4.5.4 (dev) | **Sain** : version publiée le 07/10/2023, bien avant la campagne |
| WPPConnect (15–16/11), node-ipc, `@beproduct/nestjs-auth` | absents | — |

### Actions proposées
1. 🟠 **Node 24.22.3** dans `apps/Dockerfile` (4 `FROM`), `.nvmrc`, puis reconstruction et déploiement.
2. 🟠 **Scanner l'image** (`trivy image` ou `docker scout cves`) pour trancher le CVE OpenSSL Alpine.
3. 🟠 Lot de dépendances : `fastify` ≥ 5.12.8, `@fastify/static` ≥ 10.1.12 (transitif), `@nestjs/throttler` 6.8.x. Retirer `@tanstack/query-core` orphelin.
4. Vérifier la version de Postgres côté Supabase.
5. Rendre OSV accessible à la session (`api.osv.dev`) pour les prochains runs, ou ajouter `osv-scanner` en CI à côté de `npm audit`.

### Sources
- Node.js, release du 11/11/2026 : [Apidog](https://apidog.com/blog/nodejs-november-2026-security-release/), [Cyber Kendra](https://www.cyberkendra.com/2026/11/nodejs-november-2026-security-update-16-cves.html), [Rescana](https://www.rescana.com/post/nodejs-cve-2026-123864-123863-https-http2-patch-now) · Brotli : [nordbeam](https://nordbeam.io/blog/nodejs-vulnerabilities-2026), [IsItPatched](https://isitpatched.com/nodejs/vulnerabilities)
- Fastify : [OffSeq CVE-2026-120216](https://radar.offseq.com/threat/cve-2026-120216-cwe-248-uncaught-exception-in-fastify-b2c27237e87cb2d4), [SentinelOne CVE-2026-84504](https://www.sentinelone.com/vulnerability-database/cve-2026-84504/), [Strix CVE-2026-130811](https://www.strix.ai/cve/CVE-2026-130811), [Strix CVE-2026-115515](https://www.strix.ai/cve/CVE-2026-115515)
- NestJS : [Strix CVE-2026-33011](https://www.strix.ai/cve/CVE-2026-33011), [SentinelOne CVE-2026-40879](https://www.sentinelone.com/vulnerability-database/cve-2026-40879/), [SentinelOne CVE-2026-35515](https://www.sentinelone.com/vulnerability-database/cve-2026-35515/), [TheHackerWire](https://www.thehackerwire.com/vendor/nestjs/)
- Clerk : [GitLab advisory CVE-2026-42349](https://advisories.gitlab.com/npm/@clerk/backend/CVE-2026-42349/), [NVD CVE-2026-42349](https://nvd.nist.gov/vuln/detail/CVE-2026-42349), [VulDB CVE-2026-34076](https://vuldb.com/vuln/354751), [Aikido](https://intel.aikido.dev/packages/npm/@clerk/backend)
- Prisma / effect : [prisma/orm#31125](https://github.com/prisma/orm/issues/31125), [Snyk prisma](https://security.snyk.io/package/npm/prisma)
- PostgreSQL : [Corgea](https://corgea.com/research/cve-2026-6460-116318-116330-116314-120145-postgresql-18-7-52-security-fixes-november-2026), [Université de Toronto](https://security.utoronto.ca/advisories/security-advisory-postgresql-52-vulnerabilities/)
- Alpine : [saltydk/autoscan#56 (CVE-2026-95691)](https://github.com/saltydk/autoscan/issues/56), [linuxcompatible.org](https://www.linuxcompatible.org/story/alpine-linux-3218-3226-3236-and-3242-ships-openssl-security-updates/), [Cyber Kendra sshhole](https://www.cyberkendra.com/2026/11/cve-2026-123158-openssh-sshhole-bypass-hits-alpine-linux.html)
- Supply chain : [postmortem TanStack](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem), [Snyk TanStack](https://snyk.io/blog/tanstack-npm-packages-compromised/), [Strobes](https://strobes.co/blog/tanstack-npm-supply-chain-attack/), [ThreatMon WPPConnect](https://threatmon.io/wppconnect-supply-chain-attack-malicious-npm-releases-expose-whatsapp-sessions-and-developer-secrets/), [CSA SG](https://www.csa.gov.sg/alerts-and-advisories/advisories/ad-2026-009/)
- Autres : [Snyk pdfkit](https://security.snyk.io/package/npm/pdfkit), [nestjs/nest#4598](https://github.com/nestjs/nest/issues/4598), [release-watch @nestjs/throttler](https://github.com/ofri-peretz/eslint/pull/1534)
