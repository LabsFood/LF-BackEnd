# Plan d'audit de sécurité — LF-BackEnd

> Auto-évaluation de sécurité (threat modeling + pentest théorique boîte grise) sur **notre propre** API.
> Périmètre : `LF-BackEnd` uniquement (NestJS + Fastify + Prisma + Clerk + Stripe). Les fronts
> (`batchcooking-web`, `labsfood-web`, `admin-dashboard`) sont hors périmètre — consommateurs seulement.
>
> Statut : **plan à valider**. Une fois validé → packagé en skill `/lf-security-audit` relançable à tout moment.
> Date : 2026-10-20 · Basé sur la branche `develop`.

---

## 0. Cadre & base de références

### Référentiels appliqués
- **OWASP API Security Top 10 (2023)** — grille principale (API1 BOLA, API2 Broken Auth, API5 BFLA…).
- **OWASP ASVS** — checklist de vérification niveau applicatif.
- **CNIL — Guide de la sécurité des données personnelles, éd. 2024** (restructuré en 5 parties / 25 fiches, cadré sur l'**art. 32 RGPD**). Fiches directement applicables : **Fiche 25 « API »** (nouvelle en 2024), fiche authentification, fiche journalisation (logs conservés **6 mois à 1 an** selon le risque, eux-mêmes des données personnelles à sécuriser).
- **ANSSI** — documents réels et citeables (vérifiés) : *Recommandations de sécurité pour l'architecture d'un système de journalisation*, **v2.0, 28/01/2022** (directement applicable à notre journalisation / art. 32 CNIL) ; *Note technique Sécurité Web* **DAT-NT-009, 2013** (ancienne, à prendre avec recul) ; *Guide d'hygiène informatique*. ⚠️ **Aucun guide ANSSI dédié « API REST » n'existe** — ne pas en inventer ; pour l'API, le référentiel est CNIL Fiche 25 + OWASP.

### Historique / jurisprudence servant de base (précédents réels)
- **CNIL, 27 janvier 2021 — credential stuffing** : un responsable de traitement et son sous-traitant sanctionnés **150 000 € + 75 000 €** (art. 32 RGPD). Grief : avoir **tardé à limiter le nombre de requêtes par adresse IP et/ou à poser un CAPTCHA** face à des vagues d'attaques (plusieurs dizaines de notifications de violation 2018-2020). → **Mappe directement sur notre Cible 3** (rate-limiting partiel + contournable).
- **CNIL, avril 2025 — sécurisation des grandes bases de données** : réaction à la hausse des **violations massives** en 2024. → Pertinent pour nos fuites potentielles via BOLA (Cible 2).
- **Tendance CNIL/ANSSI 2024-2025** : les fuites massives passent de plus en plus par des **API mal cloisonnées** (autorisation au niveau objet) et de l'**énumération** non limitée.

> ⚠️ Les montants/dates CNIL et les docs ANSSI ci-dessus ont été **vérifiés par recherche web** (sources en fin de document). Reste à confirmer par lecture des PDF officiels avant publication externe.

---

## 1. Stratégie de test — failles logiques & injections

Approche **boîte grise** (on a le code source) en 2 couches : revue de code ciblée → vérification dynamique sur un déploiement de test (jamais en production, jamais avec des clés Stripe `live`).

### 1.1 Failles de logique métier (le risque n°1 ici)
Le code est propre côté injections classiques ; le vrai danger est la **logique métier** (paiement, URSSAF, commissions, réservations). Stratégie :

| Cible logique | Question d'attaque | Comment tester |
|---|---|---|
| **Montants de paiement** | Puis-je payer moins que dû, ou créer un PaymentIntent avec un montant que je contrôle ? | Rejouer `POST /bookings/:id/settle` et les intents en manipulant `amount`/`maxCesuCents` ; vérifier que le montant est **recalculé serveur** (`domain/pricing.ts`) et jamais pris du body. |
| **URSSAF avance immédiate** | Puis-je faire marquer une prestation « payée » sans flux réel ? | Vérifier que `URSSAF_GATEWAY=simulated` est **impossible avec une clé `sk_live_`** (déjà bloqué par `env.validation.ts` — confirmer en runtime). |
| **Commission plateforme** | Puis-je esquiver la facture B / le débit de commission ? | Suivre `commission-debits.service` : statuts, nb max de tentatives, verrou `FOR UPDATE`. |
| **Réservations** | Double-booking, réservation dans le passé, slot déjà pris, `SAME_PERSON` ? | Courses concurrentes sur `POST /me/bookings` (race condition sur le slot). |
| **Transitions d'état** | Puis-je passer un booking `pending → completed` sans paiement, ou ré-ouvrir un `cancelled` ? | Fuzzer le `PATCH /me/bookings/:id { status }` sur tous les états. |
| **Workflow chef** | Un chef `role=chef` mais `isVerified=false` peut-il déjà agir ? | Appeler chaque route `chef/*` avec un compte chef non vérifié (voir Cible 2). |

**Livrable** : une matrice « état → transition autorisée → qui » validée contre le code, + tests de course (concurrence) sur booking/slot et commission.

### 1.2 Injections
- **SQL** : risque **faible** — Prisma partout, et les quelques `$queryRaw` sont des *tagged templates* paramétrés (`${chefProfileId}::uuid` est bindé, pas concaténé). Aucun `$queryRawUnsafe` dans le code applicatif. → **À maintenir** : interdire `*Unsafe` via règle ESLint/revue.
- **Injection de filtre Prisma / mass assignment** : risque réel si un DTO laisse passer un **objet** là où un scalaire est attendu (ex. `{ "id": { "not": null } }`). Mitigé par le `ValidationPipe` global (`whitelist + forbidNonWhitelisted + transform`). → Tester : envoyer des valeurs objet/tableau sur les champs de query (`status`, `from`, `to`, pagination) et vérifier le rejet 400.
- **Injection de logs** : `genReqId` accepte `x-request-id` entrant (tronqué 64). Vérifier qu'un `\n`/`\r` injecté n'altère pas une ligne de log JSON (faible, mais à couvrir).
- **SSRF / webhooks** : les URL de redirection Stripe Connect (`STRIPE_CONNECT_*_URL`) sont des env, pas du user input → OK. Vérifier qu'aucun endpoint ne fetch une URL fournie par l'utilisateur.
- **En-têtes / CORS** : allowlist exacte sans wildcard (`credentials:true` + origines exactes) → OK. Confirmer qu'aucun env de preview ne pousse un `CORS_ORIGINS` trop large.

---

## 2. Simulation d'attaque — Top 3 cibles (pentest théorique)

> Perspective attaquant, boîte grise. Chaque cible : **ce qu'elle exploite dans notre code**, les **étapes**, l'**impact**, le **correctif**. Objectif = durcir, pas exploiter.

### 🎯 Cible 1 — Contournement d'authentification via le *fallback JWT non vérifié* (hors production)
**Code visé** : `apps/src/auth/clerk-auth.guard.ts` → `shouldVerifyClerkJwt()` + `decodeUnverifiedJwt()`.

La vérification de signature Clerk est **désactivée** si : `ENVIRONMENT === 'test'`, **ou** la clé vaut le stub `sk_test_placeholder`, **ou** `CLERK_SECRET_KEY` ne matche pas `sk_(test|live)_…`. Dans ces cas, `decodeUnverifiedJwt` lit le claim `sub` **sans vérifier la signature**. Seul `ENVIRONMENT=production` **force** une clé valide (`env.validation.ts`). Or un commentaire du code admet que *« le déploiement de test partagé tourne aussi avec ENVIRONMENT=production »* → la sécurité repose sur **une seule variable d'env**.

**Étapes d'attaque (sur un déploiement staging/preview/mal configuré) :**
1. Détecter le mode non-vérifiant : envoyer un JWT à signature bidon ; s'il est **accepté**, la vérification est off.
2. Récupérer le `clerkUserId` d'une victime (réponses d'API publiques, logs, ou un admin connu).
3. Forger un JWT `{"sub":"<clerkUserId_victime>"}` (non signé) → `Authorization: Bearer <forgé>`.
4. On **est** la victime. En ciblant le `sub` d'un admin, `AdminGuard` (qui lit `role` en base par `clerkUserId`) accorde l'accès **admin complet**.

**Impact** : prise de contrôle totale de n'importe quel compte, y compris admin. **Probabilité** : conditionnée à une mauvaise config — mais staging/preview sont souvent exposés et sous-sécurisés.

**Correctif** :
- Rendre le fallback **fail-closed** partout sauf derrière un flag **local explicite** (ex. `ALLOW_UNVERIFIED_JWT=true` jamais positionné en déployé).
- Étendre la contrainte Joi `CLERK_SECRET_KEY required+pattern` à `staging` (et tout env déployé), pas seulement `production`.
- **Alarme de démarrage** : logguer en `warn`/`error` + métrique si le chemin non vérifié est actif, pour détection immédiate.

---

### 🎯 Cible 2 — Autorisation au niveau objet/fonction (BOLA / BFLA) portée par la couche service
**Code visé** : tous les contrôleurs `me-*` et `chef/*` ne portent que `@UseGuards(ClerkAuthGuard)` — **pas** de `ChefGuard`, **pas** de guard par objet. L'autorisation « cet objet m'appartient » / « je suis bien un chef vérifié » vit **uniquement dans les services**.

> **✅ VÉRIFIÉ (revue statique) — le contrôle est correct aujourd'hui, pas de BOLA trouvée.**
> - `bookings.service.ts` : `scope(caller)` injecte `clientId = moi` (client) / `chefProfileId = moi` (chef) dans **tout** `where` ; `view()` fait `findFirst({ where:{ id, ...scope } })` → l'id d'un autre renvoie `null` → **404**. Scoping propriétaire confirmé.
> - `chefIdentity()` (le gate chef) lève **`NOT_A_CHEF`** si pas de profil et **`CHEF_NOT_VERIFIED`** si `!isVerified` → `role=chef` seul **ne donne accès à rien** (résout l'Orange #7).
> - `quotes.service.ts` : `loadForClient(userId, id)` est owner-scoped ; le `load(id)` non scopé est la **méthode admin** (routes admin gatées). `recordUrssafOutcome(id)` non scopé est **admin/URSSAF only** (documenté). → convention cohérente : `*ForClient`/`For(role,user,id)` = scopé ; `load(id)`/`recordX(id)` = admin-gated.
>
> **La faiblesse n'est donc pas une vuln active, mais structurelle : zéro défense en profondeur.** Le jour où une nouvelle méthode non-admin fait `findUnique({ where:{ id } })` sans scope, ou où une route `chef/*` résout l'utilisateur **sans** passer par `chefIdentity`, la fuite est silencieuse et rien au niveau guard ne la rattrape. C'est un **risque de régression** sur de la **PII financière**.

**Étapes d'attaque (à rejouer en test pour prévenir toute régression) :**
1. Avec le compte A, lister ses ressources et récupérer des UUID.
2. Avec le compte B, rejouer chaque route `:id` (bookings, quotes, conversations, `fiscal-attestations`, `payment-options`, `calendar.ics`) en injectant les UUID de A → attendu **404**. (Bookings : confirmé 404 par revue ; les autres restent à **confirmer dynamiquement**, surface par surface.)
3. Créer un compte **client** simple et appeler les routes `chef/*` → attendu **`NOT_A_CHEF`**. Vérifier qu'**aucune** route `chef/*` ne contourne `chefIdentity`.
4. Chef `role=chef` mais `isVerified=false` → attendu **`CHEF_NOT_VERIFIED`** sur toute action chef.

**Impact (si régression)** : fuite de **PII financière** (attestations fiscales, CESU, adresses, messages) → violation **art. 32 / Fiche 25 CNIL**, notification obligatoire, risque de sanction (cf. CNIL avril 2025 sur les bases massives).

**Correctif (durcissement anti-régression, pas de vuln à patcher en urgence)** :
- **`ChefGuard`** (chef vérifié + actif) en défense en profondeur sur les contrôleurs `chef/*` — l'autorisation ne dépend plus que du corps des services.
- Convention testée : tout accès objet non-admin passe par une méthode `*For(caller, id)` scopée ; interdire en revue les `findUnique({ where:{ id } })` sur les chemins non-admin.
- Suite de tests « cross-tenant » : pour chaque route `:id`, un test « compte B → 404 sur l'objet de A ».

---

### 🎯 Cible 3 — Rate-limiting partiel + confiance proxy totale (`trustProxy: true`)
**Code visé** : `main.ts` (`trustProxy: true`), `app.module.ts` (ThrottlerModule configuré **mais non global**), appliqué à la main via `@UseGuards(ThrottlerGuard)` sur register/paiements/routes publiques seulement.

Deux faiblesses qui se combinent :
- **Couverture** : seuls register (5/h), paiements (20/min) et quelques routes publiques sont limités. **Tout le reste** — bookings, quotes, messaging, et surtout les routes `:id` énumérables — est **sans limite**.
- **Contournement** : `trustProxy: true` fait confiance à **tous** les hops → l'IP sur laquelle le throttler compte vient de `X-Forwarded-For`, **spoofable** par l'attaquant. Les quelques limites existantes tombent avec un `X-Forwarded-For` tournant.

**Étapes d'attaque :**
1. Sur une route limitée (ex. register, ou settle paiement), envoyer N requêtes au-delà du seuil en faisant **tourner `X-Forwarded-For`** → le throttler compte par « IP » distincte → limite inopérante.
2. Sur les routes `:id` non limitées, **énumérer** les UUID / tester BOLA en masse sans friction (synergie avec Cible 2).
3. Credential stuffing / brute force sur les points d'auth non throttlés.

**Impact** : énumération massive, brute force, abus des flux paiement. C'est **exactement** le grief de la **CNIL (27/01/2021)** — absence de limitation par IP / CAPTCHA → **150 000 € + 75 000 €**.

**Correctif** :
- `trustProxy` = **nombre exact de hops** connus (Railway = `1`), pas `true`, pour que l'IP cliente soit fiable.
- Throttler **global** (`APP_GUARD`) avec overrides par route, + `@SkipThrottle`/`@Throttle` ciblés.
- CAPTCHA ou défi sur les points sensibles non authentifiés (register, contact).
- (Bonus) Détection credential stuffing + alerte, conformément à la jurisprudence CNIL.

---

## 3. Audit de configuration

| Point | État | Sévérité | Action |
|---|---|---|---|
| Vérif. JWT Clerk gated par `ENVIRONMENT` | ⚠️ fail-open hors prod | **NOIR** | Voir Cible 1 — fail-closed + alarme. |
| `trustProxy: true` | ⚠️ confiance totale | **ROUGE** | Fixer au nb de hops (1). |
| Rate-limiting non global | ⚠️ partiel | **ROUGE** | Throttler global. |
| Pas d'`APP_GUARD` global d'auth | ⚠️ nouveau contrôleur = public par défaut | **ORANGE** | `ClerkAuthGuard` global + `@Public()` opt-out. |
| Helmet `contentSecurityPolicy: false` | ℹ️ API JSON, impact faible | **ORANGE** | Garder un CSP minimal `default-src 'none'`. |
| Swagger `/docs` + `/openapi.json` exposés | ⚠️ divulgue toute la surface d'API | **ORANGE** | Protéger/désactiver en prod (ou basic auth). |
| CORS allowlist exacte, pas de wildcard | ✅ bon | — | Surveiller `CORS_ORIGINS` des previews. |
| `ValidationPipe` whitelist+forbid+transform | ✅ bon (anti mass-assignment) | — | Maintenir. |
| Webhooks : vérif signature **fail-closed** (503 si secret absent) | ✅ bon | — | Rendre les secrets webhook **requis** en prod (actuellement `allow('')`). |
| URSSAF `simulated` interdit avec `sk_live_` | ✅ bon | — | Confirmer en runtime. |
| Logs structurés, PII filtrée (URL sans query, token calendrier masqué) | ✅ bon | — | Vérifier qu'aucun log ne sort un `sub`/email en clair. |

---

## 4. Audit de gestion des secrets

| Point | État | Sévérité |
|---|---|---|
| `.gitignore` couvre `.env` / `.env.*` avec `!.env.example` | ✅ bon | — |
| Seuls `.env.example` trackés, aucun secret en dépôt | ✅ bon | — |
| Aucun secret en dur dans `apps/src` (scan clean ; les « hits » = blob WASM Prisma, faux positifs) | ✅ bon | — |
| Secrets lus via `ConfigService` / env, validés par Joi | ✅ bon | — |
| Secrets webhook (`STRIPE_WEBHOOK_SECRET`, `CLERK_WEBHOOK_SIGNING_SECRET`) `allow('')` **même en prod** | ⚠️ un secret vide **désactive** le webhook (503, fail-closed) mais passe la validation | **ORANGE** → rendre `required` en prod. |
| `CLERK_SECRET_KEY` requis+pattern **uniquement en prod** | ⚠️ voir Cible 1 | **NOIR** (lié). |
| Rotation des secrets (Clerk/Stripe/Brevo/DB) | ❓ non vérifiable dans le code | **ORANGE** → documenter la procédure + cadence (Railway). |
| Nouveaux env ajoutés sur Railway (develop→staging→prod) | rappel mémoire projet | — | Respecter à chaque nouveau secret. |

> Rappel mémoire : **base de données en lecture seule**, pas de migration/écriture non demandée. Ces audits restent **statiques/dynamiques sur env de test**, pas d'écriture DB.

---

## 5. Bilan de sécurité (synthèse noir / rouge / orange)

### ⚫ NOIR — critique (à traiter en priorité absolue)
1. **Contournement d'auth via fallback JWT non vérifié hors production** (Cible 1) — prise de contrôle totale possible sous mauvaise config d'un env déployé. La sécurité tient à une seule variable (`ENVIRONMENT`).

### 🔴 ROUGE — haute
2. **`trustProxy: true` + rate-limiting non global** (Cible 3) — énumération/brute force/abus paiement ; précédent CNIL direct (150k€+75k€). *Confirmé par revue de code.*

### 🟠 ORANGE — moyenne
3. **BOLA/BFLA sans défense en profondeur** (Cible 2) — **downgradé** : revue statique = **pas de vuln active** (scoping propriétaire correct, gate chef `isVerified` confirmé). Risque **structurel / de régression** sur PII financière faute de guard. → `ChefGuard` + tests cross-tenant.
4. Pas d'`APP_GUARD` d'auth global (nouveau contrôleur public par défaut).
5. Swagger exposé en prod (divulgation de surface d'API).
6. Secrets webhook `allow('')` en prod ; CSP désactivé ; rotation des secrets non documentée.
7. ~~Chef `role=chef` avant approbation~~ — **résolu** : `chefIdentity` gate sur `isVerified` (`CHEF_NOT_VERIFIED`). Résiduel : vérifier qu'aucune route `chef/*` ne contourne ce helper.

### 🟢 Points forts confirmés (à préserver)
- Discipline des guards admin (`ClerkAuthGuard` + `AdminGuard` partout), webhooks fail-closed à signature vérifiée, `ValidationPipe` strict, CORS exact, Prisma paramétré (SQLi faible), rôles non auto-assignables, secrets hors dépôt, logs PII-filtrés.

---

## 6. Plan d'exécution & packaging en skill

**Ordre recommandé** : Cible 1 (NOIR) → Cible 3 (quick win, précédent CNIL) → Cible 2 (pentest cross-tenant + helper/ChefGuard) → ORANGE.

**Prochaine étape** : après ta validation de ce plan, je le **transforme en skill `/lf-security-audit`** relançable à tout moment, qui :
1. relit les surfaces sensibles (guards, webhooks, config, secrets, routes `:id` et `chef/*`) sur l'état courant du code ;
2. régénère ce bilan noir/rouge/orange avec les écarts vs cette baseline ;
3. propose une checklist de tests dynamiques (BOLA cross-tenant, spoof `X-Forwarded-For`, fallback JWT) à lancer sur un env de **test** ;
4. ne touche **ni** la DB **ni** la production, ne commit rien sans demande.

---

### Sources (base de références)
- OWASP API Security Top 10 (2023) — projet OWASP.
- [CNIL — Guide de la sécurité des données personnelles, éd. 2024](https://www.cnil.fr/fr/guide-de-la-securite-des-donnees-personnelles-nouvelle-edition-2024) · [suivi des modifications (Fiche 25 API)](https://www.cnil.fr/fr/modifications-guide-de-la-securite-des-donnees-personnelles)
- [CNIL — sanction credential stuffing (27/01/2021, 150k€+75k€)](https://www.lemondeinformatique.fr/actualites/lire-la-cnil-sanctionne-la-securite-inadaptee-de-deux-societes-face-au--credential-stuffing-81794.html) · [Next](https://next.ink/brief-article/la-cnil-sanctionne-deux-entreprises-incapables-de-prevenir-une-attaque-par-credential-stuffing/)
- [ANSSI — Recommandations de sécurité pour l'architecture d'un système de journalisation (v2.0, 28/01/2022)](https://cyber.gouv.fr/sites/default/files/2022/01/anssi-guide-recommandations_securite_architecture_systeme_journalisation.pdf) · [Note technique Sécurité Web DAT-NT-009 (2013, datée)](https://cyber.gouv.fr/sites/default/files/IMG/pdf/NP_Securite_Web_NoteTech.pdf) · [publications ANSSI](https://cyber.gouv.fr/publications)
- OWASP ASVS — à consulter pour la checklist de vérification.
