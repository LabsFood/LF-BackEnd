<!--
Release develop → main de l'API.
Ouvrir avec : https://github.com/LabsFood/LF-BackEnd/compare/main...develop?expand=1&template=release.md

Titre (Conventional Commits, il fixe la version calculée par semantic-release) :
  feat: release develop → main (<2-3 sujets>)   → version mineure
  fix: release develop → main (<sujet>)          → correctif
  feat!: ...  ou « BREAKING CHANGE: » ci-dessous → version majeure

CHANGELOG.md, le tag et apps/package.json sont écrits par semantic-release après
la fusion : ne pas les modifier à la main. Le journal ci-dessous sert à la relecture
et à la note de version GitHub.
-->

## Version
- En prod : `vX.Y.Z`
- Attendue après fusion : `vX.Y.Z`
- Commits depuis `main` : N (`git log --oneline origin/main..origin/develop`)

## Journal des changements

### Ajouts
- **Sujet** : ce qui change pour l'utilisateur (#PR)

### Corrections
- Ce qui était cassé et ce qui marche maintenant (#PR ou sha)

### Changements techniques
- Dépendances, refactor, CI (supprimer si vide)

### Changements cassants
- Aucun (sinon : ce qui casse et comment migrer)

## Nouveaux endpoints
- `METHODE /chemin` : rôle (supprimer si aucun)

## Migrations DB
Appliquées par `prisma migrate deploy` au démarrage du conteneur.

1. `AAAAMMJJHHMMSS_nom` : ce qu'elle fait (additive, idempotente, perte de données ?)

## Variables d'environnement (prod `API-Mainstream`)
| Variable | Valeur / défaut | Si absente |
|---|---|---|
| `NOM` | | |

À poser **après** le déploiement de l'image qui les lit, jamais avant.

## Ordre de déploiement
- [ ] Cette PR en premier (la console et le site appellent ses endpoints)
- [ ] Puis admin-dashboard #__ et batchcooking-web #__

## Avant fusion
- [ ] CI verte (lint, tests, image Docker, titre de PR)
- [ ] Fusion sans conflit avec `main` (version de `package.json` = celle de `main`)
- [ ] Variables de prod prêtes, services externes prêts (Stripe, Brevo, Supabase…)
- [ ] Testé sur develop

## Après fusion
- [ ] Release `vX.Y.Z` publiée et CHANGELOG.md recommité sur `main`
- [ ] « Deploy production » approuvé (environnement `production`)
- [ ] Migrations appliquées, `/health` OK, pas de nouvelle erreur Sentry
- [ ] `main` refusionnée dans `develop` si besoin

🚫 Ne pas fusionner sans l'accord explicite de MajorD.
