# Rapport d'audit sécurité — LF-BackEnd — 2026-10-20 (run `--quick`)

> Régression express sur les 3 cibles connues. Diff vs baseline `docs/security/audit-securite-plan.md` (2026-10-20).
> Lecture seule — aucune écriture DB/prod, non commité. Branche `develop` @ `b370f11`.

## Résultat : ✅ 0 régression — état courant = baseline

| Cible | Vérif courante | Diff |
|---|---|---|
| ⚫ **1 — fallback JWT non vérifié** | `shouldVerifyClerkJwt` : `env==='test'` ou stub ou clé hors pattern ⇒ pas de vérif (`clerk-auth.guard.ts:109-112`). `env.validation.ts:37-38` : `CLERK_SECRET_KEY` requis+pattern **seulement `is: 'production'`** (toujours pas `staging`). | **INCHANGÉ** |
| 🔴 **3 — trustProxy + throttler** | `main.ts:72` `trustProxy: true` ; `app.module.ts:42` throttler « enforced only where ThrottlerGuard is attached » → **pas d'`APP_GUARD` global**. | **INCHANGÉ** |
| 🟠 **2 — BOLA (anti-régression)** | `scope()` + `view()` présents (`bookings.service.ts`) ; `chefIdentity` gate `NOT_A_CHEF`/`CHEF_NOT_VERIFIED` présent (`users.service.ts`). Aucun **nouveau** contrôleur non gardé ; chef routes toujours `ClerkAuthGuard` + authz via `chefIdentity`. | **INCHANGÉ** |

### Contrôles de régression Phase 0/2
- **Contrôleurs sans guard** : `health`, `clerk-webhooks`, `stripe-webhooks`, `referentials` — **tous attendus** (health public ; webhooks authentifiés par signature ; referentials = données de référence read-only). Aucun **nouveau**. ⚠️ confirmer que `referentials.controller.ts` n'expose que du référentiel non sensible.
- **Helpers d'autorisation** intacts (`scope`/`view` = 2 occ., `chefIdentity` = 4 occ.).

## Bilan ⚫🔴🟠 (inchangé)
- ⚫ **NOIR** : Cible 1 — fallback JWT non vérifié hors prod. *À traiter en priorité.*
- 🔴 **ROUGE** : Cible 3 — `trustProxy:true` + throttler non global (précédent CNIL 27/01/2021, art. 32).
- 🟠 **ORANGE** : Cible 2 (régression/défense en profondeur — ajouter `ChefGuard`) ; APP_GUARD global ; Swagger exposé ; secrets webhook `allow('')` prod ; CSP off.

## Checklist tests dynamiques (humain, env de test uniquement) — non exécutée ici
- [ ] JWT à signature bidon → 401 sur tout env déployé (Cible 1).
- [ ] Compte B rejoue UUID de A sur `/me/bookings/:id`, `/quotes/:id`, `/me/conversations/:id`, `fiscal-attestations`, `payment-options`, `calendar.ics` → 404.
- [ ] Client → `chef/*` = `NOT_A_CHEF` ; chef non vérifié = `CHEF_NOT_VERIFIED`.
- [ ] Seuil register/paiement avec `X-Forwarded-For` tournant → la limite tient.
- [ ] Règlement booking avec `amount` body < prix serveur → recalculé/refusé.

Mapping : Cible 1 → OWASP API2 (Broken Auth) ; Cible 2 → API1/API5 (BOLA/BFLA) + CNIL Fiche 25 ; Cible 3 → CNIL art. 32 (27/01/2021).
