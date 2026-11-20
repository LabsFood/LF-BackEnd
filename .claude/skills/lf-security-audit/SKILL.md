---
name: lf-security-audit
description: "Audit de sécurité relançable de LF-BackEnd (NestJS/Fastify/Prisma/Clerk/Stripe). Relit les surfaces sensibles (auth, autorisation objet/BOLA, webhooks, config, secrets, injections, logique métier paiement) sur l'état COURANT du code, fait la veille CVE / avis éditeurs / supply chain sur les dépendances, le runtime et l'image, régénère un bilan noir/rouge/orange en diff vs baseline, et sort une checklist de tests dynamiques. Lecture seule : ne touche ni DB ni prod, ne commit rien. Déclencher avec /lf-security-audit, ou pour toute demande d'audit sécu / revue de menaces / pentest théorique sur LF-BackEnd."
---

# /lf-security-audit

Self-audit de sécurité de **LF-BackEnd uniquement**. Méthodologie de threat modeling + revue
boîte grise, rejouable à tout moment pour produire un bilan à jour en **diff vs la baseline**
du 2026-10-20 (plan de référence : `docs/security/audit-securite-plan.md`).

## Garde-fous (NON négociables)
- **Lecture seule.** Grep/Read/revue statique. Aucune écriture DB, aucune migration, rien en prod.
- **Ne jamais exécuter d'attaque réelle** ici. Les tests dynamiques sont **décrits** (checklist) pour
  être lancés par l'humain sur un **env de test** (jamais prod, jamais clés Stripe `live`).
- **Ne rien committer.** L'utilisateur possède git (cf. mémoire projet).
- **Pas de secrets en clair** dans le rapport. Si un secret en dur est trouvé → signaler l'emplacement, pas la valeur.
- Périmètre = `apps/src/**` de LF-BackEnd. Les fronts sont hors scope.

## Usage
```
/lf-security-audit                 # audit complet, régénère le bilan en diff vs baseline
/lf-security-audit --quick         # seulement les 3 cibles connues (régression express)
/lf-security-audit --surface auth  # cible une surface : auth | authz | webhooks | config | secrets | injections | logic | veille
/lf-security-audit --surface veille  # seulement la Phase 4bis (CVE, avis éditeurs, supply chain)
```
`--quick` lance aussi `npm audit --omit=dev` (Phase 4bis B), sans la veille web.

## Procédure

### Phase 0 — Cartographie (toujours)
```bash
cd <LF-BackEnd>
find apps/src -name "*.controller.ts" | grep -v spec | sort
find apps/src -type f \( -name "*.guard.ts" -o -name "*auth*.ts" \) | grep -v spec
```
But : repérer tout **nouveau** contrôleur/guard depuis la baseline. Un nouveau contrôleur **sans `@UseGuards`** = public par défaut → à signaler.

### Phase 1 — Authentification & bootstrap  (⚫ Cible 1)
Lire `apps/src/auth/clerk-auth.guard.ts`, `apps/src/config/env.validation.ts`, `apps/src/main.ts`.
Vérifier :
- `shouldVerifyClerkJwt()` : la vérif de signature est-elle **fail-closed** hors `test`/stub ? Le fallback `decodeUnverifiedJwt` est-il atteignable sur un env déployé ?
- `env.validation.ts` : `CLERK_SECRET_KEY required+pattern` est-il étendu à **staging** (pas seulement `production`) ?
- `main.ts` : `trustProxy` = nombre de hops (pas `true`) ? Helmet/CSP ? Swagger `/docs` + `/openapi.json` protégés en prod ?

### Phase 2 — Autorisation objet/fonction  (🟠 Cible 2 — anti-régression)
Lire `apps/src/modules/bookings/bookings.service.ts` (`caller`/`scope`/`view`), `apps/src/modules/users/users.service.ts` (`chefIdentity`).
```bash
# Matrice des guards (tout admin doit avoir ClerkAuthGuard + AdminGuard)
grep -rn "UseGuards" apps/src --include="*.controller.ts" | sort
# Lookups par id NON scopés sur chemins potentiellement non-admin (le risque de régression)
grep -rn "findUnique({ *$\|findFirst(" apps/src/modules --include="*.service.ts" | grep -v spec
grep -rn "where: { id }" apps/src/modules --include="*.service.ts" | grep -v spec
```
Pour chaque `findUnique/findFirst({ where:{ id } })` **sans** `clientId`/`chefProfileId`/owner : tracer l'appelant.
Attendu (baseline) : scopé via `scope(caller)` OU méthode **admin-gated** (`load(id)`, `recordX(id)`). Tout autre cas = **régression BOLA** → 🔴.
Vérifier que **chaque** route `chef/*` résout l'utilisateur via `chefIdentity` (gate `NOT_A_CHEF` / `CHEF_NOT_VERIFIED`).

### Phase 3 — Webhooks & secrets
Lire `apps/src/modules/stripe-webhooks/stripe-webhooks.service.ts` + `clerk-webhooks.service.ts` (`verifyAndHandle`).
- Vérif signature **fail-closed** (503 si secret absent) ? Toujours `constructEvent` / `verifyWebhook` ?
```bash
git ls-files | grep -iE "\.env|secret|credential"          # attendu : uniquement *.env.example
grep -iE "env|secret" .gitignore                            # attendu : .env / .env.* / !.env.example
grep -rniE "(sk_live_|sk_test_[a-z0-9]{20,}|whsec_|AKIA|-----BEGIN)" apps/src --include="*.ts" \
  | grep -v spec | grep -v "generated/prisma"               # attendu : 0 (le blob Prisma = faux positif)
```
Vérifier aussi : secrets webhook `required` en prod (pas `allow('')`), rappel « nouveaux env sur Railway ».

### Phase 4 — Injections & logique métier
```bash
grep -rniE "queryRawUnsafe|executeRawUnsafe" apps/src --include="*.ts" | grep -v generated   # attendu : 0
```
- `ValidationPipe` global toujours `whitelist + forbidNonWhitelisted + transform` dans `main.ts` ?
- **Logique paiement** : `domain/pricing.ts` recalcule-t-il le montant côté serveur (jamais depuis le body) ? `URSSAF_GATEWAY=simulated` impossible avec `sk_live_` ? Commission : verrou `FOR UPDATE`, nb max de tentatives ?
- Transitions d'état booking (`PATCH /me/bookings/:id`) : pas de saut `pending→completed` sans paiement.

### Phase 4bis — Veille vulnérabilités (CVE, avis éditeurs, supply chain)
Ce qui n'est pas dans le code mais tourne avec lui : dépendances npm, runtime Node, image Docker, services gérés.
Toujours en lecture seule : on **mesure** l'exposition, on ne met rien à jour (proposer les montées de version dans le rapport).

**A. Inventaire des versions** (la base de toute la phase)
```bash
cd apps
node -e 'const l=require("./package-lock.json").packages;
for (const n of ["@nestjs/core","@nestjs/platform-fastify","@nestjs/platform-ws","@nestjs/throttler","@nestjs/swagger",
  "fastify","@fastify/helmet","@fastify/static","@fastify/cors","@fastify/middie","find-my-way","ws","@clerk/backend",
  "stripe","@prisma/client","prisma","@prisma/config","effect","deepmerge-ts","pg","@supabase/supabase-js",
  "@aws-sdk/client-s3","@sentry/nestjs","ioredis","pdfkit","fontkit","class-validator","class-transformer","joi",
  "validator","libphonenumber-js","swagger-ui-dist","path-to-regexp","cookie","semver"]) {
  const p=l["node_modules/"+n]; if(p) console.log(n, p.version, p.dev?"(dev)":""); }'
grep -n "^FROM" Dockerfile; cat ../.nvmrc          # Node + Alpine de l'image
grep -n "^FROM" ../ops/db-backup/Dockerfile        # image du service db-backup (postgres + alpine)
```

**B. Scanners automatiques**
```bash
npm audit --omit=dev --json   # prod (ce que la CI gate, au niveau critical seulement)
npm audit --json              # tout, dev inclus (runners CI = surface supply chain)
# OSV (base Google, plus large que GHSA) : osv-scanner --lockfile=package-lock.json
#   ou l'API https://api.osv.dev/v1/querybatch. Si le proxy réseau la refuse : le noter dans le rapport.
# Image : trivy image <image> (ou docker scout) si Docker/trivy sont disponibles ; sinon décrire la commande
#   dans la checklist humaine.
```
`npm audit` ne voit que les avis déjà publiés dans GitHub Advisory : un 0 ici ne suffit pas, d'où C.

**C. Veille web (WebSearch, mode `extended`, requêtes envoyées dans le même tour)**
Chercher les avis des **60 derniers jours** pour chaque brique, puis croiser chaque CVE avec la version de A :
- runtime : `Node.js security release <mois> <année>` ; image `node:<ver>-alpine<ver>` (OpenSSL, musl, busybox) ;
- framework : NestJS (core, platform-fastify, platform-ws, throttler, swagger), Fastify + plugins (`@fastify/*`, find-my-way) ;
- auth / paiement : `@clerk/backend` (avis GHSA de `clerk/javascript`), SDK `stripe` Node ;
- données : Prisma (et ses dépendances `effect`, `deepmerge-ts`), `pg`, PostgreSQL (Supabase géré + image db-backup) ;
- autres : `ws`, `@supabase/supabase-js`, `@sentry/nestjs`, `pdfkit`/`fontkit`, `class-validator`/`class-transformer` ;
- supply chain : `npm supply chain attack compromised packages <mois> <année>`. Pour chaque campagne,
  chercher les noms dans le lockfile (prod **et** dev) et vérifier la date de publication de la version
  installée (`npm view <pkg>@<ver> time --json`) par rapport à la fenêtre de compromission.

Règles :
- **Sources primaires d'abord** : GHSA (github.com/advisories), NVD/cve.org, blog/annonce de l'éditeur
  (nodejs.org, postgresql.org, postmortem). Les agrégateurs (SentinelOne, Strix, VulDB, OffSeq, Aikido…)
  se contredisent souvent sur les versions et les scores : un CVE vu **seulement** chez un agrégateur
  est marqué « non confirmé ».
- **Applicabilité** : une version vulnérable n'est pas une faille tant que le code n'emprunte pas le
  chemin touché (option activée, transport utilisé, HTTP/2 ou TLS servi par Node ou terminé au bord Railway…).
  Le dire, preuve à l'appui (grep).
- Ne mettre dans les requêtes que des **noms et versions publics** de paquets ; jamais le nom du
  projet, de domaine, d'utilisateur ni de dépôt.

**Sévérité** : version vulnérable **et** chemin atteignable → appliquer la rubrique (RCE / contournement
d'auth exploitable à distance = ⚫, DoS distant non authentifié ou fuite mémoire = 🔴). Version
vulnérable mais chemin non atteignable, ou avis non confirmé → 🟠 « mettre à jour ».

### Phase 5 — Bilan & livrable
Produire `docs/security/audit-securite-rapport-AAAA-MM-JJ.md` :
1. **Diff vs baseline** : NOUVEAU / RÉSOLU / INCHANGÉ pour chaque item.
2. **Bilan ⚫🔴🟠** (rubrique ci-dessous).
3. **Checklist tests dynamiques** à lancer sur env de test (ci-dessous).
4. Mapping CNIL art. 32 / Fiche 25 / OWASP API Top 10 pour chaque ⚫🔴.
5. **Veille vulnérabilités** (Phase 4bis) : tableau `CVE / avis | composant | version chez nous | version corrigée | applicable ? | action`,
   résultat des scanners (et ceux qui n'ont pas pu tourner), campagnes supply chain vérifiées, liste des sources.

## Rubrique de sévérité
- **⚫ NOIR (critique)** : contournement d'auth, prise de contrôle de compte, fuite massive de PII, mouvement de fonds non autorisé. Exploitable seul ou sous mauvaise config plausible.
- **🔴 ROUGE (haute)** : BOLA/BFLA active, brute force/énumération non limitée, escalade de privilège conditionnelle, précédent de sanction CNIL.
- **🟠 ORANGE (moyenne)** : défense en profondeur manquante, risque de régression, divulgation d'info, durcissement de config.

## Baseline connue (2026-10-20) — un run est un DIFF vs ceci
**⚫ Cible 1** — fallback JWT non vérifié hors prod (`shouldVerifyClerkJwt`, gating `ENVIRONMENT=production` seul).
**🔴 Cible 3** — `trustProxy: true` + throttler non global (`main.ts`/`app.module.ts`). Précédent CNIL 27/01/2021.
**🟠 Cible 2** — BOLA : **pas de vuln active** (scope propriétaire correct + gate `chefIdentity` sur `isVerified`) ; risque de régression, pas de guard. Ajouter `ChefGuard`.
**🟠 autres** — pas d'`APP_GUARD` global ; Swagger exposé ; secrets webhook `allow('')` en prod ; CSP off.
**🟢 sains (ne pas casser)** — guards admin disciplinés, webhooks fail-closed signés, `ValidationPipe` strict, CORS exact, Prisma paramétré (aucun `*Unsafe`), rôles non auto-assignables, secrets hors dépôt, logs PII-filtrés.

## Checklist tests dynamiques (pour l'humain, env de test uniquement)
- [ ] **Cible 1** : envoyer un JWT à signature bidon → doit être **rejeté** (401) sur tout env déployé.
- [ ] **Cible 2 BOLA** : compte B rejoue les UUID de A sur `GET /me/bookings/:id`, `/quotes/:id`, `/me/conversations/:id`, `fiscal-attestations`, `payment-options`, `calendar.ics` → attendu **404**.
- [ ] **Cible 2 BFLA** : compte client appelle `chef/*` → attendu **NOT_A_CHEF** ; chef non vérifié → **CHEF_NOT_VERIFIED**.
- [ ] **Cible 3** : dépasser le seuil register/paiement en faisant tourner `X-Forwarded-For` → la limite doit tenir.
- [ ] **Logique** : tenter de régler un booking avec un `amount` du body inférieur au prix serveur → doit être recalculé/refusé.

## Références
- CNIL — Guide sécurité données personnelles éd. 2024 (art. 32, **Fiche 25 API**, journalisation 6 mois–1 an) ; sanction credential stuffing 27/01/2021 (150k€+75k€).
- OWASP API Security Top 10 (2023) ; OWASP ASVS.
- ANSSI — Architecture d'un système de journalisation (v2.0, 2022) ; Note Sécurité Web DAT-NT-009 (2013, datée). (Pas de guide ANSSI « API REST » : pour l'API → CNIL Fiche 25 + OWASP.)
- Plan de référence complet : `docs/security/audit-securite-plan.md`.
