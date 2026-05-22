# Lab's Food — Spécification Backend & Batch Cooking

> Périmètre : fonctionnalités de l'application **batch cooking** (espace client `labs-food`)
> et **services backend** à développer pour faire fonctionner l'ensemble de l'écosystème
> (site principal `labs-food-main`, espace client, et console d'administration `admin-labsfood`).
>
> État actuel : les 3 frontends existent et tournent sur des **données mock**. Ce document
> décrit ce que le backend doit fournir pour les rendre réels.

---

## 1. Vue d'ensemble

Lab's Food est une maison culinaire (Côte d'Azur) avec trois produits numériques :

| Application | Dossier | Rôle |
|---|---|---|
| Site principal | `labs-food-main` | Vitrine : services, produit Kossam, recrutement, contact |
| Espace client batch cooking | `labs-food` | Réservation de sessions, suivi, menus, messagerie |
| Console admin | `admin-labsfood` | Pilotage interne de toute l'activité |

Le **backend est commun aux trois** : une seule API, une seule base de données.

### Principe directeur

- Le **client final** réserve et suit ses sessions via l'espace client.
- L'**administrateur / chef** gère tout via la console admin.
- Le **site principal** alimente le backend (formulaires de contact, candidatures, commandes Kossam).

---

## 2. Architecture cible

### 2.1 Stack recommandée

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTENDS (Next.js)                                         │
│  • labs-food-main      → site vitrine                        │
│  • labs-food           → espace client (Next 14)             │
│  • admin-labsfood      → console admin (Next 16)             │
└───────────────┬─────────────────────────────────────────────┘
                │  HTTPS / REST ou tRPC
┌───────────────▼─────────────────────────────────────────────┐
│  API BACKEND                                                 │
│  • Node.js (NestJS) ou Next.js Route Handlers                │
│  • Authentification : JWT + refresh token (ou NextAuth)      │
│  • Couche services métier (réservations, devis, paiement…)   │
│  • Validation : Zod / class-validator                        │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│  PERSISTANCE & SERVICES EXTERNES                             │
│  • PostgreSQL (via Prisma ORM)                               │
│  • Stripe        → paiements & remboursements                │
│  • Stockage objet (S3 / Cloudinary) → images plats, avatars  │
│  • Service email (Resend / Postmark) → notifications         │
│  • SMS (Twilio / Brevo) → rappels jour J                     │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Modules backend

| Module | Responsabilité |
|---|---|
| `auth` | Inscription, connexion, refresh token, rôles, reset mot de passe |
| `users` | Profil client, préférences alimentaires, foyer, adresses |
| `catalog` | Plats, recettes du monde, menus hebdomadaires, formules |
| `reservations` | Cycle de vie d'une session batch cooking |
| `quotes` | Demandes sur-mesure & devis |
| `shopping-lists` | Génération des listes de courses par rayon |
| `messaging` | Fil de discussion client ↔ admin/chef |
| `payments` | Intégration Stripe, statuts de paiement, crédit d'impôt |
| `kossam` | Commandes du produit Kossam (site principal) |
| `recruitment` | Candidatures « Devenir chef » |
| `contact` | Messages reçus depuis le site principal |
| `reviews` | Avis & témoignages, modération |
| `notifications` | Email + SMS + notifications in-app |
| `stats` | Agrégations pour les tableaux de bord |

### 2.3 Rôles & permissions

| Rôle | Accès |
|---|---|
| `client` | Espace client uniquement (ses propres données) |
| `chef` | Console admin : ses sessions, messagerie, menus |
| `admin` | Console admin : accès complet |

---

## 3. Fonctionnalités — Espace client batch cooking

> Pages existantes dans `labs-food/app/espace-client/`. Chaque fonctionnalité ci-dessous
> doit être branchée sur une API réelle.

### 3.1 Authentification
- Inscription / connexion (email + mot de passe).
- Garde d'accès : redirection vers `/auth/login` si non connecté.
- Persistance de session.
- **Backend** : `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.

### 3.2 Aperçu (dashboard)
- Prochaine session mise en avant.
- Statistiques personnelles : sessions réalisées, plats cuisinés, heures gagnées, crédit d'impôt cumulé.
- Sessions récentes, dernier message, demande sur-mesure en cours.
- **Backend** : `GET /me/dashboard` (agrégation).

### 3.3 Mes commandes
- Liste filtrable des réservations (toutes / en attente / à venir / livrées).
- Page détail : suivi par étapes, plats prévus, liste de courses, récap facturation, consignes.
- Demande d'annulation.
- **Backend** : `GET /me/reservations`, `GET /me/reservations/:id`, `POST /me/reservations/:id/cancel`.

### 3.4 Menus de la semaine
- Catalogue des plats de la semaine en cours.
- Sélection de 3 à 7 plats → démarrage d'une réservation.
- **Backend** : `GET /menus/current`.

### 3.5 Réservation (flux 4 étapes)
1. **Plats** — sélection des plats.
2. **Infos** — date, créneau, adresse, nombre de personnes, option courses.
3. **Paiement** — Stripe.
4. **Confirmation** — référence générée.
- Calcul du tarif : forfait de base + plats supplémentaires + personnes supplémentaires + option courses.
- **Backend** : `POST /reservations` (création), `POST /payments/intent` (Stripe), webhook Stripe.

### 3.6 Personnalisation (demande sur-mesure)
- Formulaire : nombre de personnes, plats, style culinaire, régimes, brief libre.
- Suivi des demandes : statut, devis reçu, acceptation.
- **Backend** : `POST /quotes`, `GET /me/quotes`, `POST /me/quotes/:id/accept`.

### 3.7 Messagerie
- Fil de discussion avec le chef / l'équipe.
- Réponses rapides pré-rédigées.
- **Backend** : `GET /me/thread`, `POST /me/thread/messages` + temps réel (WebSocket / SSE).

### 3.8 Profil
- Régimes alimentaires, allergies, plats préférés, aliments à éviter.
- Niveau d'épice, composition du foyer, notes sur la cuisine.
- **Backend** : `GET /me/profile`, `PATCH /me/profile`.

### 3.9 Statistiques
- KPI personnels et graphique d'activité hebdomadaire.
- **Backend** : `GET /me/stats`.

### 3.10 Paramètres
- Compte (nom, email, téléphone, adresse), sécurité (mot de passe).
- Préférences de notification, langue, devise.
- Export RGPD, suppression de compte.
- **Backend** : `PATCH /me/account`, `PATCH /me/password`, `PATCH /me/notifications`, `GET /me/export`, `DELETE /me`.

---

## 4. Fonctionnalités backend transverses à développer

### 4.1 Cycle de vie d'une réservation
```
pending → confirmed → shopping → cooking → delivered
                    ↘ cancelled
```
- À la création : statut `pending`, génération de référence (`LF-AAAA-NNNN`).
- Confirmation admin → `confirmed`.
- Génération automatique de la liste de courses → `shopping`.
- Jour J → `cooking` → `delivered`.
- Chaque transition déclenche une **notification** (email/SMS/in-app).

### 4.2 Génération de liste de courses
- À partir des plats sélectionnés, agréger les ingrédients par rayon
  (Fruits & légumes, Boucherie & poisson, Épicerie…).
- Calcul des quantités selon le nombre de portions.
- Service `shopping-lists` consommé par l'espace client et la console admin.

### 4.3 Paiement & crédit d'impôt
- Intégration Stripe : `PaymentIntent`, webhooks (`succeeded`, `refunded`).
- Le **crédit d'impôt service à la personne** est de 50 % : stocker `amountTTC` et
  `amountAfterTax = amountTTC / 2`.
- Statuts de paiement : `pending`, `paid`, `refunded`.

### 4.4 Devis sur-mesure
```
submitted → in-review → quoted → accepted
                              ↘ declined
```
- L'admin chiffre la demande → un objet `quote` est attaché.
- L'acceptation d'un devis peut générer une réservation.

### 4.5 Notifications
- **Email** : confirmation, rappel, liste de courses prête, devis.
- **SMS** : rappel jour J.
- **In-app** : badge sur la cloche (topbar).
- Préférences par canal stockées par utilisateur.

### 4.6 Statistiques & agrégations
- Endpoints d'agrégation pour les dashboards (client et admin) :
  CA mensuel, sessions, répartition par formule, top plats, tendance 7 mois.

---

## 5. Schéma de données

> Modèle relationnel illustratif (PostgreSQL / Prisma). Les types `enum` sont indiqués.

### 5.1 Diagramme des relations

```
User ─┬─< Reservation >─┬─ Chef (User role=chef)
      │                 └─< ReservationMeal >── Meal
      ├─< Quote          └── ShoppingList >─< ShoppingItem
      ├─< ChatThread >─< ChatMessage
      ├─  ClientProfile (1-1)
      └─< Payment

Meal ──< MenuWeek (plats publiés par semaine)
Formule (référentiel des forfaits)
KossamOrder >─< KossamOrderItem
ChefApplication / ContactMessage / Review (entités site principal)
ServiceZone
```

### 5.2 Entités

#### `User`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| name | string | |
| email | string | unique |
| passwordHash | string | |
| phone | string | |
| role | enum | `client` \| `chef` \| `admin` |
| avatar | string? | URL |
| createdAt | datetime | |

#### `ClientProfile` (1-1 avec `User` rôle client)
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| userId | uuid (FK → User) | |
| dietaryPreferences | string[] | régimes |
| allergies | string[] | |
| dislikes | string[] | aliments à éviter |
| favorites | string[] | |
| spiceLevel | int (1–5) | |
| householdAdults | int | |
| householdKids | int | |
| kitchenNotes | text | |
| addressStreet / City / PostalCode | string | |
| status | enum | `vip` \| `active` \| `prospect` \| `inactive` |

#### `Meal` (plat / recette)
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| name | string | |
| description | text | |
| image | string | URL |
| continent | enum | Europe, Afrique, Asie, Amériques, Moyen-Orient |
| country | string | |
| portions | int | |
| prepTime | int | minutes |
| dietaryTags | string[] | vegan, halal, sans-gluten… |
| allergens | string[] | |
| calories | int | |
| difficulty | enum | Facile \| Moyen \| Difficile |
| ingredients | json[] | `{ name, quantity, unit, aisle }` |
| steps | string[] | étapes de la recette |
| isFeatured | boolean | |
| status | enum | `published` \| `draft` \| `archived` |

#### `MenuWeek` (menu hebdomadaire)
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| weekNumber | int | |
| year | int | |
| mealIds | uuid[] | plats proposés cette semaine |
| publishedAt | datetime? | |

#### `Formule` (forfait)
| Champ | Type | Notes |
|---|---|---|
| id | string (PK) | `essentiel`, `confort`, `premium`, `sur-mesure` |
| name | string | |
| price | int | TTC |
| priceAfterTax | int | après crédit d'impôt |
| duration | string | |
| mealsCount | int | |
| persons | string | |
| features | string[] | |
| popular | boolean | |
| active | boolean | |

#### `Reservation`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| reference | string | `LF-2026-0142`, unique |
| clientId | uuid (FK → User) | |
| chefId | uuid (FK → User) | |
| formuleId | string (FK → Formule) | |
| date | date | |
| timeSlot | string | |
| persons | int | |
| amountTTC | int | |
| amountAfterTax | int | |
| status | enum | pending, confirmed, shopping, cooking, delivered, cancelled |
| shoppingByClient | boolean | |
| address | string | |
| notes | text? | consignes du client |
| paymentId | uuid (FK → Payment) | |
| createdAt | datetime | |

#### `ReservationMeal` (table de jonction)
| Champ | Type |
|---|---|
| reservationId | uuid (FK) |
| mealId | uuid (FK) |
| portions | int |

#### `ShoppingList` / `ShoppingItem`
| ShoppingList | Type |
|---|---|
| id | uuid (PK) |
| reservationId | uuid (FK) |
| generatedAt | datetime |

| ShoppingItem | Type |
|---|---|
| id | uuid (PK) |
| shoppingListId | uuid (FK) |
| aisle | string (rayon) |
| name | string |
| quantity | string |

#### `Quote` (demande sur-mesure)
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| reference | string | `DEM-2026-031` |
| clientId | uuid (FK → User) | |
| title | string | |
| persons | int | |
| mealsCount | int | |
| cuisine | string | |
| diet | string[] | |
| brief | text | |
| status | enum | submitted, in-review, quoted, accepted, declined |
| assignedChefId | uuid? (FK → User) | |
| quoteAmountTTC | int? | |
| quoteAmountAfterTax | int? | |
| quoteNote | text? | |
| createdAt | datetime | |

#### `ChatThread` / `ChatMessage`
| ChatThread | Type |
|---|---|
| id | uuid (PK) |
| clientId | uuid (FK → User) |
| topic | string |
| lastMessageAt | datetime |

| ChatMessage | Type |
|---|---|
| id | uuid (PK) |
| threadId | uuid (FK) |
| from | enum (`client` \| `admin`) |
| text | text |
| read | boolean |
| createdAt | datetime |

#### `Payment`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| reservationId | uuid? (FK) | |
| stripePaymentIntentId | string | |
| amount | int | |
| status | enum | `pending` \| `paid` \| `refunded` |
| createdAt | datetime | |

#### `Notification`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| userId | uuid (FK) | |
| channel | enum (`email` \| `sms` \| `in-app`) | |
| type | string | `reservation_confirmed`, `quote_received`… |
| payload | json | |
| readAt | datetime? | |
| createdAt | datetime | |

---

## 6. Endpoints API (résumé)

| Méthode | Route | Rôle | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Inscription client |
| POST | `/auth/login` | public | Connexion |
| GET | `/me/dashboard` | client | Agrégat de l'aperçu |
| GET | `/me/reservations` | client | Liste des réservations |
| GET | `/me/reservations/:id` | client | Détail |
| POST | `/reservations` | client | Créer une réservation |
| POST | `/me/reservations/:id/cancel` | client | Demander une annulation |
| GET | `/menus/current` | public | Menu de la semaine |
| POST | `/quotes` | client | Soumettre une demande sur-mesure |
| POST | `/me/quotes/:id/accept` | client | Accepter un devis |
| GET/POST | `/me/thread` | client | Messagerie |
| GET/PATCH | `/me/profile` | client | Profil culinaire |
| GET | `/me/stats` | client | Statistiques personnelles |
| POST | `/payments/intent` | client | Créer un PaymentIntent Stripe |
| POST | `/webhooks/stripe` | Stripe | Webhook paiement |

---
