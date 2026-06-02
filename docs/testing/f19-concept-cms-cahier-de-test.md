# Cahier De Test - F19 Page "Notre Concept" CMS

## Objective

Qualify the CMS-backed "Notre Concept" feature before release. The feature exposes public reading through `GET /content/concept` and admin editing through `PUT /content/concept`.

## Scope

In scope:

- Public content read.
- Admin-only content update.
- CMS persistence in PostgreSQL.
- DTO validation for text blocks, image metadata, steps, and reassurance items.
- Swagger/OpenAPI visibility.
- Non-regression of existing health, users, and bookings endpoints.

Out of scope for MVP:

- Image binary upload.
- Rich text editor behavior in frontend applications.
- Multilingual content.
- Version history or rollback UI.

## Test Environment

Use the same backing services as local development to preserve dev/prod parity:

```bash
sudo dockerd &>/tmp/dockerd.log &
sudo docker compose up -d postgres redis
cd apps
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
export REDIS_URL="redis://localhost:6379/0"
export CLERK_SECRET_KEY="sk_test_placeholder"
npm run migration:run
npm run start:dev
```

Generate a local Clerk-like token:

```bash
node -e 'const h = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"); const p = Buffer.from(JSON.stringify({sub:"user_test_admin",email:"admin@example.com"})).toString("base64url"); console.log(`${h}.${p}.signature`);'
```

## Required Test Data

| Data | Purpose |
| --- | --- |
| `concept` CMS page row | Public page content source. Seed by migration or default service path. |
| Admin user with `role = admin` | Positive `PUT /content/concept` authorization. |
| Client user with `role = client` | Negative `PUT /content/concept` authorization. |
| Invalid JWT | Negative auth test. |
| Valid concept payload | Positive update test. |
| Invalid concept payload | DTO validation test. |

## Functional Test Cases

| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| F19-FUNC-001 | Public visitor reads concept page | Call `GET /content/concept` without `Authorization`. | `200`; response includes page title, hero, intro blocks, "Comment ca marche", and reassurance items. |
| F19-FUNC-002 | Public response uses latest saved CMS content | Update content as admin, then call public GET. | `200`; GET response matches the latest persisted update. |
| F19-FUNC-003 | Admin updates concept content | Call `PUT /content/concept` with admin token and valid payload. | `200`; saved DTO is returned; `updatedAt` changes. |
| F19-FUNC-004 | Non-admin cannot update content | Call `PUT /content/concept` with valid non-admin token. | `403 Forbidden`; content is unchanged. |
| F19-FUNC-005 | Missing token cannot update content | Call `PUT /content/concept` without `Authorization`. | `401 Unauthorized`; content is unchanged. |
| F19-FUNC-006 | Invalid token cannot update content | Call `PUT /content/concept` with malformed bearer token. | `401 Unauthorized`; content is unchanged. |
| F19-FUNC-007 | DTO rejects incomplete payload | Omit required title or section arrays in `PUT`. | `400 Bad Request` from global validation pipe. |
| F19-FUNC-008 | DTO rejects invalid image metadata | Send invalid URL/object shape for an image field. | `400 Bad Request`; validation message identifies the invalid field. |
| F19-FUNC-009 | Default content exists on fresh database | Start with fresh PostgreSQL volume and run migrations. Call `GET /content/concept`. | `200`; deterministic default `concept` content is available. |
| F19-FUNC-010 | Swagger documents the endpoints | Open `/docs` or `/openapi.json`. | `GET /content/concept` and `PUT /content/concept` are present; write route shows bearer auth. |

## Non-Regression Test Cases

| ID | Scenario | Command or Steps | Expected Result |
| --- | --- | --- | --- |
| F19-NR-001 | Unit tests pass | `cd apps && npm test` | Existing and new Jest tests pass. |
| F19-NR-002 | Build passes | `cd apps && npm run build` | TypeScript compilation succeeds. |
| F19-NR-003 | Lint passes | `cd apps && npm run lint` | ESLint and Prettier checks pass. |
| F19-NR-004 | Health endpoint unchanged | Call `GET /health`. | `200 {"status":"ok"}`. |
| F19-NR-005 | Readiness endpoint unchanged | Call `GET /ready` with Postgres and Redis running. | `200` readiness response. |
| F19-NR-006 | Existing protected routes still require auth | Call `GET /bookings` without token. | `401 Unauthorized`. |

## API Payload Example

```json
{
  "title": "Notre Concept",
  "hero": {
    "title": "Labs Food, le chef a domicile simplifie",
    "subtitle": "Composez votre experience, reservez, profitez.",
    "image": {
      "src": "concept/hero.jpg",
      "alt": "Chef Labs Food preparant un repas a domicile"
    }
  },
  "introBlocks": [
    {
      "title": "Ce qu'est Labs Food",
      "body": "Une experience culinaire personnalisee avec un chef professionnel."
    }
  ],
  "howItWorks": [
    {
      "title": "Choisissez votre menu",
      "description": "Selectionnez une prestation adaptee a vos envies.",
      "image": {
        "src": "concept/menu.jpg",
        "alt": "Choix du menu"
      }
    },
    {
      "title": "Reservez",
      "description": "Confirmez la date, le lieu et les preferences.",
      "image": {
        "src": "concept/reservation.jpg",
        "alt": "Reservation de prestation"
      }
    },
    {
      "title": "Profitez a domicile",
      "description": "Le chef gere la prestation sur place.",
      "image": {
        "src": "concept/prestation.jpg",
        "alt": "Chef a domicile"
      }
    }
  ],
  "reassuranceItems": [
    {
      "title": "Hygiene",
      "body": "Des pratiques professionnelles pour une prestation sereine."
    },
    {
      "title": "Chef professionnel",
      "body": "Des profils qualifies et verifies."
    },
    {
      "title": "Personnalisation",
      "body": "Une experience adaptee a vos convives."
    }
  ]
}
```

## Exit Criteria

- All functional cases from `F19-FUNC-001` to `F19-FUNC-010` are passed or explicitly waived.
- All non-regression cases from `F19-NR-001` to `F19-NR-006` are passed.
- Test evidence is recorded in `docs/testing/f19-concept-cms-test-execution.md`.
- Open questions from `docs/features/f19-concept-cms.md` are resolved or converted into follow-up issues.
