# Rapport d'audit sécurité — LF-BackEnd — 2026-10-24 (run `--quick`)

> Régression express sur les 3 cibles connues. Diff vs baseline `docs/security/audit-securite-plan.md` (2026-10-20)
> et vs le run précédent (`b370f11`). Lecture seule — aucune écriture DB/prod, non commité.
> Branche `fix/node-pin-db-tls` @ `0a34c37` (26 commits depuis `b370f11`, 29 fichiers touchés sous `apps/src`).

## Résultat : ✅ 0 régression — les 3 cibles sont INCHANGÉES (toujours ouvertes)

| Cible | Vérif courante | Diff |
|---|---|---|
| ⚫ **1 — fallback JWT non vérifié** | `shouldVerifyClerkJwt` : `env==='test'` ou stub ou clé hors pattern ⇒ `decodeUnverifiedJwt` (`clerk-auth.guard.ts:110-113`). `env.validation.ts:36-39` : `CLERK_SECRET_KEY` requis+pattern **seulement `is: 'production'`** (toujours pas `staging`). Seul changement depuis `b370f11` : un commentaire `nosemgrep` sur le stub `sk_test_placeholder` (placeholder public, pas un secret). | **INCHANGÉ** |
| 🔴 **3 — trustProxy + throttler** | `main.ts:72` `trustProxy: true` ; `app.module.ts:42-44` throttler « enforced only where ThrottlerGuard is attached » → **pas d'`APP_GUARD` global**. `ThrottlerGuard` présent sur register, paiements, contact, vitrine, disponibilités, calendar feed. | **INCHANGÉ** |
| 🟠 **2 — BOLA (anti-régression)** | `scope()`/`view()` présents (`bookings.service.ts`) ; gate `NOT_A_CHEF`/`CHEF_NOT_VERIFIED` présent (`users.service.ts:144-150`). Aucun **nouveau** contrôleur ; aucun nouveau contrôleur non gardé. | **INCHANGÉ** |

### Contrôles de régression Phase 0/2 (routes nouvelles ou modifiées depuis `b370f11`)
- **Contrôleurs sans guard** : `health`, `clerk-webhooks`, `stripe-webhooks`, `referentials` — mêmes 4, tous attendus.
  - `referentials` gagne `GET /referentials/languages` : renvoie la constante statique `LANGUAGES` (codes ISO 639-1). Non sensible, public OK. Le ⚠️ du run précédent est levé pour cette route.
- **`PATCH /admin/chefs/:id/zones`** (nouveau) : `ClerkAuthGuard + AdminGuard` au niveau classe (`admin-chefs.controller.ts:102`), `ParseUUIDPipe`, DTO repris de la candidature, refus si non vérifié, **audité** (before/after). Lookup par `id` non scopé = **admin-gated, attendu**.
- **`PATCH /admin/chefs/:id/sap-external-status`** : `AdminGuard` (`users.controller.ts:348`) ; **durci** — `ParseUUIDPipe` ajouté, erreur typée `SAP_PROFILE_NOT_FOUND`, audit avec acteur + statuts avant/après.
- **`PATCH /me/chef-profile`** (+ `languages`) : scopé propriétaire (`chefProfile.findUnique({ where: { userId } })`) + gate `isVerified` → `CHEF_NOT_VERIFIED` (`users.service.ts:460-476`) ; `languages` validé `@IsArray @ArrayUnique @IsIn(LANGUAGE_CODES, { each: true })`.

### Hors cibles, vus dans le diff (🟢, ne pas casser)
- **TLS base de données** : connexions Supabase vérifiées avec `rejectUnauthorized: true` + CA Supabase épinglée ; les paramètres TLS de l'URL sont retirés pour qu'ils ne remplacent pas l'option `ssl` (`supabase/db-connection.ts:51-64`). CLI Prisma en `sslaccept=strict` (`:71-79`). `apps/certs/supabase-prod-ca-2021.crt` = certificat CA public, pas un secret.
- **Clé Supabase** : `SUPABASE_SECRET_KEY` doit commencer par `sb_secret_` ; le JWT `service_role` hérité est refusé (`env.validation.ts:150-161`). Les clés héritées peuvent rester désactivées côté Supabase.
- **Traçabilité** : les écritures admin (zones, statut SAP) laissent une trace d'audit avec acteur, conformément à CNIL art. 32 (journalisation).

### ⚠️ À vérifier côté opérations (hors code)
- `SUPABASE_SECRET_KEY` doit être posée sur Railway (develop → staging → production) et `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` retirées ; sans elle le Storage (KYC, pièces jointes) est indisponible.

## Bilan ⚫🔴🟠 (inchangé)
- ⚫ **NOIR** : Cible 1 — fallback JWT non vérifié hors prod. *Toujours prioritaire* : étendre `is: 'production'` à `staging` (`valid('staging','production')`) et faire échouer le guard (fail-closed) dès que `ENVIRONMENT` ∉ {`development`,`test`}.
- 🔴 **ROUGE** : Cible 3 — `trustProxy: true` + throttler non global (précédent CNIL 27/01/2021, art. 32).
- 🟠 **ORANGE** : Cible 2 (défense en profondeur — `ChefGuard`) ; pas d'`APP_GUARD` global ; Swagger exposé ; secrets webhook `allow('')` en prod ; CSP off. *(Non re-vérifiés en `--quick` hormis le premier.)*

## Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici
- [ ] JWT à signature bidon → 401 sur tout env déployé, **staging inclus** (Cible 1).
- [ ] Compte B rejoue les UUID de A sur `/me/bookings/:id`, `/quotes/:id`, `/me/conversations/:id`, `fiscal-attestations`, `payment-options`, `calendar.ics` → 404.
- [ ] Client → `chef/*` = `NOT_A_CHEF` ; chef non vérifié = `CHEF_NOT_VERIFIED` (y compris `PATCH /me/chef-profile`).
- [ ] Compte non admin → `PATCH /admin/chefs/:id/zones` et `/sap-external-status` = 403 ; `:id` non UUID = 400.
- [ ] Seuil register/paiement avec `X-Forwarded-For` tournant → la limite tient.
- [ ] Règlement booking avec `amount` body < prix serveur → recalculé/refusé.

Mapping : Cible 1 → OWASP API2 (Broken Authentication) + CNIL art. 32 ; Cible 2 → API1/API5 (BOLA/BFLA) + CNIL Fiche 25 ; Cible 3 → API4 (Unrestricted Resource Consumption) + CNIL art. 32 (sanction 27/01/2021).
