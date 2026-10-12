# Lab's Food — Spécification Console d'administration

> Périmètre : la console **`admin-labsfood`** — l'outil interne de pilotage de toute
> l'activité Lab's Food (batch cooking, demandes sur-mesure, clients, produit Kossam,
> recrutement, site principal).
>
> État actuel : interface complète développée en **Next.js 16 + Tailwind 4**, fonctionnant
> sur des **données mock** (`lib/mock/`). Ce document liste les fonctionnalités et le
> modèle de données pour le branchement backend.

---

## 1. Vue d'ensemble

La console admin reflète **côté gestion** ce que les clients voient côté espace client.
À chaque fonctionnalité utilisateur correspond une fonctionnalité d'administration.

| Côté client (batch cooking)           | Côté admin (console)                    |
| ------------------------------------- | --------------------------------------- |
| Je réserve une session                | Je vois / gère toutes les réservations  |
| Je fais une demande sur-mesure        | Je chiffre et j'envoie un devis         |
| J'écris à mon chef                    | Je réponds dans la messagerie           |
| Je remplis mon profil                 | Je consulte la fiche client (CRM)       |
| Je choisis des plats du menu          | Je compose le menu et gère le catalogue |
| Je commande du Kossam (site)          | Je suis les commandes Kossam            |
| Je postule comme chef (site)          | Je traite les candidatures              |
| J'envoie un message de contact (site) | Je réponds depuis la boîte de réception |
| Je laisse un avis                     | Je modère les avis publiés              |

## 2. Architecture

### 2.1 Arborescence du projet

```
admin-labsfood/
├── app/
│   ├── layout.tsx              → racine : polices + AuthProvider
│   ├── globals.css             → thème Tailwind 4 (@theme) + classes utilitaires
│   ├── login/page.tsx          → page de connexion (mock)
│   └── (admin)/                → groupe de routes protégé
│       ├── layout.tsx          → garde d'accès + sidebar + topbar + nav mobile
│       ├── page.tsx            → Vue d'ensemble
│       ├── reservations/       → liste + [id] détail
│       ├── demandes/           → demandes sur-mesure & devis
│       ├── messagerie/         → conversations clients
│       ├── clients/            → CRM : liste + [id] fiche
│       ├── menus/              → plats & menu de la semaine
│       ├── recettes/           → recettes du monde
│       ├── formules/           → forfaits & tarifs
│       ├── kossam/             → commandes produit Kossam
│       ├── candidatures/       → recrutement chefs
│       ├── contact/            → messages du site principal
│       ├── avis/               → modération des avis
│       ├── equipe/             → chefs, staff & zones de service
│       └── parametres/         → réglages console & compte
├── components/
│   ├── Providers.tsx           → wrapper client (AuthProvider)
│   ├── admin/                  → Sidebar, Topbar, MobileNav, Logo
│   └── ui/                     → Badge, StatCard, FilterTabs, EmptyState…
└── lib/
    ├── auth.tsx                → contexte d'authentification (mock)
    ├── nav.tsx                 → configuration de la navigation
    ├── status.ts               → correspondances statut → couleur
    ├── utils.ts                → helpers (dates, euros, initiales)
    └── mock/                   → données fictives (en attendant l'api)
```

### 2.2 Couches

```
┌──────────────────────────────────────────────┐
│  Pages (app/(admin)/**)                       │  ← composants client interactifs
├──────────────────────────────────────────────┤
│  Composants UI partagés (components/ui)       │  ← Badge, StatCard, FilterTabs…
│  Shell (components/admin)                     │  ← Sidebar, Topbar, MobileNav
├──────────────────────────────────────────────┤
│  Logique (lib/)                               │  ← auth, nav, status, utils
├──────────────────────────────────────────────┤
│  Données mock (lib/mock/) → REMPLACER PAR API │
└──────────────────────────────────────────────┘
```

> **Point d'intégration** : remplacer les imports `lib/mock/*` par des appels à l'API
> backend (cf. [`SPEC-BACKEND.md`](./SPEC-BACKEND.md)). Chaque fichier mock correspond à une
> ressource d'API.

### 2.3 Authentification & rôles

- Garde d'accès dans `app/(admin)/layout.tsx` : redirection vers `/login` si non connecté.
- Auth actuelle : **mock** (localStorage). À remplacer par JWT / NextAuth.
- Rôles attendus : `admin` (accès total), `chef` (accès restreint à ses sessions,
  sa messagerie et le catalogue).

---

## 3. Modules & fonctionnalités

### 3.1 Vue d'ensemble (`/`)

- Bannière de bienvenue + prochaine session.
- 4 KPI : CA du mois, sessions, clients actifs, devis en attente (avec tendance %).
- Graphique de chiffre d'affaires sur 7 mois (batch cooking + Kossam).
- Répartition des sessions par formule.
- Liste des sessions à venir.
- Top des plats commandés, demandes récentes, raccourci Kossam.
- **API** : `GET /admin/dashboard`.

### 3.2 Réservations (`/reservations`, `/reservations/[id]`)

- Liste filtrable (toutes / en attente / confirmées / en cuisine / livrées) + recherche.
- Stats : total, à venir, CA cumulé.
- **Détail** : suivi par étapes avec **changement de statut**, plats prévus,
  liste de courses par rayon, facturation (crédit d'impôt), fiche client liée,
  consignes, action d'annulation.
- **API** : `GET /admin/reservations`, `GET /admin/reservations/:id`,
  `PATCH /admin/reservations/:id` (statut), `POST /admin/reservations/:id/cancel`.

### 3.3 Demandes sur-mesure (`/demandes`)

- Liste filtrable par statut (nouvelles / en analyse / devis envoyés / acceptées).
- Pour chaque demande : brief, métadonnées (personnes, plats, cuisine, régimes).
- **Établir un devis** : saisie du montant, calcul du reste à charge, envoi.
- Affichage du devis et du chef assigné.
- **API** : `GET /admin/quotes`, `PATCH /admin/quotes/:id` (devis, statut, chef).

### 3.4 Messagerie (`/messagerie`)

- Vue master-détail : liste des conversations + fil de discussion.
- Compteur de messages non lus, marquage lu à l'ouverture.
- Composer + réponses rapides.
- **API** : `GET /admin/threads`, `GET /admin/threads/:id`,
  `POST /admin/threads/:id/messages` + temps réel.

### 3.5 Clients — CRM (`/clients`, `/clients/[id]`)

- Liste en cartes, filtrable (VIP / actifs / prospects / inactifs) + recherche.
- Stats : total, VIP, prospects, CA total.
- **Fiche client** : identité & contact, profil culinaire (régimes, allergies, foyer),
  KPI (sessions, dépensé, ancienneté), historique des sessions, demandes sur-mesure,
  note interne.
- **API** : `GET /admin/clients`, `GET /admin/clients/:id`, `PATCH /admin/clients/:id`.
- **Pagination** : `GET /admin/clients?page=1&limit=20&status=vip` — `limit` plafonné à 100.
  Réponse `{ data: { user, clientProfile }[], meta: { page, limit, total, totalPages, hasNextPage, hasPreviousPage } }` :
  un compte client par ligne, `clientProfile` vaut `null` tant que le client n'a pas enregistré
  ses préférences. Son `id` est celui qu'attendent `GET/PATCH /admin/clients/:id`.

### 3.6 Plats & menus (`/menus`)

- Bandeau « menu de la semaine » avec les plats publiés.
- Catalogue de plats filtrable (publiés / brouillons / archivés).
- Carte par plat : image, origine, régimes, temps de préparation, nb de commandes, statut.
- Actions : composer le menu, créer / éditer un plat.
- **API** : `GET /admin/meals`, `POST /admin/meals`, `PATCH /admin/meals/:id`,
  `GET/POST /admin/menu-weeks`.

### 3.7 Recettes du monde (`/recettes`)

- Bibliothèque groupée par continent (Europe, Afrique, Asie, Amériques, Moyen-Orient).
- Par recette : origine, régimes, temps, difficulté.
- **API** : `GET /admin/meals?group=continent`.

### 3.8 Formules & tarifs (`/formules`)

- Cartes des 4 forfaits (Essentiel, Confort, Premium, Sur-mesure).
- Prix TTC + prix après crédit d'impôt, caractéristiques, nb vendues.
- Activation / désactivation, édition.
- **API** : `GET /admin/formules`, `PATCH /admin/formules/:id`.

### 3.9 Commandes Kossam (`/kossam`, `/kossam/[id]`)

- Bandeau produit + stats (CA, bouteilles, à expédier).
- Liste filtrable par statut (nouvelles / préparation / livraison / livrées).
- Par commande : client, articles & formats, zone & date de livraison, total, paiement.
- **Détail** : suivi par étapes avec **changement de statut**, articles commandés,
  informations de livraison (adresse, créneau), récap facturation, **action
  « marquer comme payée »**, impression du bon de livraison, annulation.
- **API** : `GET /admin/kossam-orders`, `GET /admin/kossam-orders/:id`,
  `PATCH /admin/kossam-orders/:id` (statut, paiement).

### 3.10 Candidatures chef (`/candidatures`, `/candidatures/[id]`)

- Pipeline de recrutement : nouvelles → en étude → entretien → recrutées / refusées.
- Liste : aperçu candidat, spécialités, nombre de documents.
- **Détail** : pipeline avec progression de statut, programmation d'entretien,
  profil complet (expérience, tarif, véhicule, langues, cuisines, HACCP),
  lettre de motivation, **visionneuse de documents** (CV, lettre, certificat HACCP,
  diplôme, pièce d'identité, portfolio) avec aperçu PDF/image, agrandissement
  plein écran et téléchargement, notes internes, décision rapide (recruter / refuser).
- **API** : `GET /admin/applications`, `GET /admin/applications/:id`,
  `PATCH /admin/applications/:id` (statut, entretien, notes),
  `GET /admin/applications/:id/documents/:docId` (téléchargement sécurisé).

### 3.11 Messages de contact (`/contact`)

- Boîte de réception master-détail, filtrable par statut.
- Canal d'origine (formulaire / WhatsApp / email).
- Réponse + archivage, marquage lu/répondu.
- **API** : `GET /admin/contact-messages`, `PATCH /admin/contact-messages/:id`,
  `POST /admin/contact-messages/:id/reply`.

### 3.12 Avis & témoignages (`/avis`)

- Liste filtrable par service (batch cooking / Kossam / atelier) et par statut.
- Note moyenne, badge « vérifié », source.
- **Publier / masquer** un avis sur le site.
- **API** : `GET /admin/reviews`, `PATCH /admin/reviews/:id` (publication).

### 3.13 Équipe & zones (`/equipe`)

- Cartes des chefs & staff : rôle, spécialité, note, sessions, badges, statut.
- Tableau des zones de service : codes postaux, chefs, clients, statut.
- **API** : `GET /admin/team`, `PATCH /admin/team/:id`, `GET/PATCH /admin/zones`.

### 3.14 Paramètres (`/parametres`)

- Compte admin, infos entreprise, notifications, sécurité, facturation
  (TVA, crédit d'impôt, devise).
- **API** : `GET/PATCH /admin/settings`.

---

## 4. Composants transverses

| Composant        | Rôle                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `Sidebar`        | Navigation desktop, sections, badges de notification              |
| `Topbar`         | Titre de page, recherche, cloche, menu utilisateur, drawer mobile |
| `MobileNav`      | Barre de navigation basse (mobile)                                |
| `Badge`          | Pastille de statut colorée (8 tons)                               |
| `StatCard`       | Tuile KPI avec icône et tendance                                  |
| `FilterTabs`     | Rangée d'onglets de filtre avec compteurs                         |
| `EmptyState`     | État vide                                                         |
| `PageTransition` | Animation d'entrée de page                                        |

Les **badges de notification** de la sidebar (réservations en attente, demandes
nouvelles, messages non lus, candidatures, contacts) sont calculés depuis les données ;
côté backend ils proviendront de `GET /admin/dashboard/badges`.

---

## 5. Schéma de données — entités spécifiques à l'admin

> Le modèle complet (User, Reservation, Meal, Quote…) est décrit dans
> [`SPEC-BACKEND.md`](./SPEC-BACKEND.md). Ci-dessous, les entités **propres au site principal
> et à la console admin**.

### 5.1 Diagramme

```
TeamMember (chef / staff) ──< Reservation (chefId)
ServiceZone ──< ClientProfile (par code postal)

KossamOrder ──< KossamOrderItem
ChefApplication ──< ApplicationDocument   (CV, HACCP, diplôme…)
ContactMessage         (formulaire de contact du site)
Review                 (avis affichés sur le site)
```

### 5.2 Entités

#### `TeamMember` (chef ou staff)

| Champ         | Type      | Notes                          |
| ------------- | --------- | ------------------------------ |
| id            | uuid (PK) |                                |
| name          | string    |                                |
| avatar        | string?   | URL                            |
| role          | enum      | `founder` \| `chef` \| `staff` |
| specialty     | string    |                                |
| city          | string    |                                |
| phone / email | string    |                                |
| rating        | float     | note moyenne                   |
| reviewCount   | int       |                                |
| sessionsDone  | int       |                                |
| status        | enum      | `active` \| `inactive`         |
| badges        | string[]  | HACCP, spécialités…            |
| bio           | text      |                                |
| joinedAt      | date      |                                |

#### `ServiceZone`

| Champ        | Type      | Notes                    |
| ------------ | --------- | ------------------------ |
| id           | uuid (PK) |                          |
| name         | string    | ex. « Nice & alentours » |
| region       | string    | département              |
| postalCodes  | string[]  |                          |
| active       | boolean   |                          |
| chefsCount   | int       | dérivé                   |
| clientsCount | int       | dérivé                   |

#### `KossamOrder` / `KossamOrderItem`

| KossamOrder                  | Type      | Notes                                                              |
| ---------------------------- | --------- | ------------------------------------------------------------------ |
| id                           | uuid (PK) |                                                                    |
| reference                    | string    | `KOS-2026-0231`                                                    |
| customerName / email / phone | string    |                                                                    |
| total                        | decimal   |                                                                    |
| deliveryFee                  | decimal   | 0 = offerte                                                        |
| status                       | enum      | `new` \| `preparing` \| `delivering` \| `delivered` \| `cancelled` |
| paymentStatus                | enum      | `pending` \| `paid` \| `refunded`                                  |
| paymentMethod                | string    | CB, virement, espèces…                                             |
| deliveryZone                 | string    |                                                                    |
| deliveryAddress              | string    | adresse complète                                                   |
| deliveryDate                 | date      |                                                                    |
| deliverySlot                 | string    | créneau de livraison                                               |
| notes                        | text?     | consignes de livraison                                             |
| createdAt                    | datetime  |                                                                    |

| KossamOrderItem | Type                        |
| --------------- | --------------------------- |
| id              | uuid (PK)                   |
| orderId         | uuid (FK)                   |
| format          | string (`0,5 L` \| `1,5 L`) |
| quantity        | int                         |
| unitPrice       | decimal                     |

#### `ChefApplication` (candidature « Devenir chef »)

| Champ                | Type      | Notes                                                           |
| -------------------- | --------- | --------------------------------------------------------------- |
| id                   | uuid (PK) |                                                                 |
| name / email / phone | string    |                                                                 |
| city                 | string    |                                                                 |
| birthYear            | int       |                                                                 |
| experienceYears      | int       |                                                                 |
| currentRole          | string    | poste actuel                                                    |
| specialties          | string[]  |                                                                 |
| cuisines             | string[]  | cuisines maîtrisées                                             |
| languages            | string[]  |                                                                 |
| availability         | string    | disponibilités                                                  |
| hasVehicle           | boolean   |                                                                 |
| expectedRate         | decimal   | tarif horaire souhaité                                          |
| motivation           | text      |                                                                 |
| hasHaccp             | boolean   |                                                                 |
| status               | enum      | `new` \| `reviewing` \| `interview` \| `accepted` \| `rejected` |
| interviewDate        | date?     | entretien programmé                                             |
| internalNotes        | text      | notes du recruteur                                              |
| createdAt            | datetime  |                                                                 |

#### `ApplicationDocument` (document joint à une candidature)

| Champ         | Type                        | Notes                                                                      |
| ------------- | --------------------------- | -------------------------------------------------------------------------- |
| id            | uuid (PK)                   |                                                                            |
| applicationId | uuid (FK → ChefApplication) |                                                                            |
| type          | enum                        | `cv` \| `cover-letter` \| `haccp` \| `diploma` \| `id-card` \| `portfolio` |
| name          | string                      | nom du fichier                                                             |
| format        | enum                        | `pdf` \| `image`                                                           |
| sizeKb        | int                         |                                                                            |
| url           | string                      | stockage objet (S3 / Cloudinary), accès signé                              |
| pages         | int?                        | nombre de pages (PDF)                                                      |
| uploadedAt    | datetime                    |                                                                            |

#### `ContactMessage`

| Champ        | Type      | Notes                                      |
| ------------ | --------- | ------------------------------------------ |
| id           | uuid (PK) |                                            |
| name / email | string    |                                            |
| subject      | string    |                                            |
| message      | text      |                                            |
| channel      | enum      | `form` \| `whatsapp` \| `email`            |
| status       | enum      | `new` \| `read` \| `replied` \| `archived` |
| createdAt    | datetime  |                                            |

#### `Review` (avis)

| Champ     | Type      | Notes                                    |
| --------- | --------- | ---------------------------------------- |
| id        | uuid (PK) |                                          |
| author    | string    |                                          |
| city      | string    |                                          |
| rating    | int (1–5) |                                          |
| text      | text      |                                          |
| service   | enum      | `batch-cooking` \| `atelier` \| `kossam` |
| source    | string    | Site web, Google, Instagram…             |
| verified  | boolean   | client identifié                         |
| published | boolean   | visible sur le site                      |
| date      | date      |                                          |

#### `AdminSettings` (singleton)

| Champ         | Type   | Notes                         |
| ------------- | ------ | ----------------------------- |
| companyName   | string |                               |
| contactEmail  | string |                               |
| serviceArea   | string |                               |
| vatRate       | int    | TVA %                         |
| taxCreditRate | int    | crédit d'impôt % (50)         |
| currency      | string | EUR                           |
| notifications | json   | préférences par type d'alerte |

---

## 6. Statuts & codes couleur

| Domaine     | Statuts                                                          | Couleur de badge                                 |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Réservation | pending / confirmed / shopping / cooking / delivered / cancelled | warning / info / teal / terra / success / danger |
| Devis       | submitted / in-review / quoted / accepted / declined             | warning / info / terra / success / danger        |
| Kossam      | new / preparing / delivering / delivered / cancelled             | warning / info / terra / success / danger        |
| Candidature | new / reviewing / interview / accepted / rejected                | warning / info / terra / success / danger        |
| Contact     | new / read / replied / archived                                  | warning / info / success / neutral               |
| Paiement    | pending / paid / refunded                                        | warning / success / neutral                      |
| Client      | vip / active / prospect / inactive                               | terra / success / info / neutral                 |
| Plat        | published / draft / archived                                     | success / warning / neutral                      |

---

## 7. Étapes de branchement backend (à faire cote frontend)

1. Créer une couche `lib/api/` (client HTTP + types) miroir de `lib/mock/`.
2. Remplacer l'auth mock par JWT / NextAuth ; protéger `(admin)` côté serveur.
3. Brancher les pages **lecture seule** (vue d'ensemble, listes) sur l'API.
4. Brancher les **actions** (changement de statut, devis, réponses, publication d'avis).
5. Ajouter le **temps réel** sur la messagerie (WebSocket / SSE).
6. Gérer les **rôles** : restreindre les modules pour le rôle `chef`.
7. Brancher les notifications in-app (badges de la sidebar et cloche).

---

## 8. Récapitulatif des routes de la console

| Route                                  | Module              | Type     |
| -------------------------------------- | ------------------- | -------- |
| `/login`                               | Authentification    | publique |
| `/`                                    | Vue d'ensemble      | protégée |
| `/reservations` · `/reservations/[id]` | Réservations        | protégée |
| `/demandes`                            | Demandes sur-mesure | protégée |
| `/messagerie`                          | Messagerie          | protégée |
| `/clients` · `/clients/[id]`           | CRM                 | protégée |
| `/menus`                               | Plats & menus       | protégée |
| `/recettes`                            | Recettes du monde   | protégée |
| `/formules`                            | Formules & tarifs   | protégée |
| `/kossam` · `/kossam/[id]`             | Commandes Kossam    | protégée |
| `/candidatures` · `/candidatures/[id]` | Recrutement         | protégée |
| `/contact`                             | Messages de contact | protégée |
| `/avis`                                | Avis & témoignages  | protégée |
| `/equipe`                              | Équipe & zones      | protégée |
| `/parametres`                          | Réglages            | protégée |

---
