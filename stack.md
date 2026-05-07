# Schema

Architecture monolith, backend mis à disposition

- NestJS REST controllers + Fastify adapter, Swagger documentation, et
- conteneurisation Docker.

### Technos

- GitHub
- Authentification OAuth2 (par services Google/Apple) => Clerk
- Agenda => Cronofy
- Communication => Stream
- Envoi mail => Brevo 300mails/jrs **gratuit**.

### Infra et services tiers

- Hébergement => Railway
- Paiement (Stripe)
- Cartographie (GoogleMaps API)
- Stockage images (AWS S3)

### Langages

- Frontend
  - Web Framework: NextJS
  - Mobile: React Native
  - Styles : TailwindCSS
- Backend
  - API => NestJS REST controllers (OpenAPI/Swagger)
  - Runtime/langage => Node.js 20
  - Framework => NestJS 11 + FastifyAdapter

### Base de données

- BDD (PostgreSQL 16)
- ORM / migrations (TypeORM)
- Gestion cache (Redis 7)

### Flow Diagram

How the flow works

 1. User
  • Uses Next.js (web) or React Native (mobile).
  • Signs in via Clerk (OAuth2: Google/Apple).
  • Creates/updates bookings → API → NestJS.
 2. Backend (NestJS + Fastify)
  • NestJS exposes REST endpoints with Swagger docs.
  • Uses PostgreSQL via TypeORM for: users, provider profiles, service offers, availability slots, bookings.
  • Uses Redis for caching (slots, availability) and async job queues (sending emails, notifications).
 3. External services
  • Clerk: manages auth, sessions, OAuth, and user data.
  • Stripe: handles payments for bookings.
  • Cronofy: calendar sync for provider availability.
  • Brevo: sends confirmation, reminders, and promo emails.
  • Stream: real‑time chat between clients and providers.
  • Google Maps API: shows nearby providers and routes.
  • AWS S3: stores provider photos, IDs, document scans, etc.
 4. Deployment
  • Backend + DB + Redis run in Docker containers on Railway.
  • Frontend (Next.js) is deployed separately (Vercel, Netlify, or Railway).

``` mermaid
graph TD
    subgraph Frontend
        A([User])
        B[Next.js Web]
        C[React Native Mobile]
    end

    subgraph Auth_and_API["Auth & API"]
        D[Clerk Auth]
        E[NestJS REST API]
        F[Docker]
        G[Redis cache / queue]
        H[PostgreSQL]
    end

    subgraph External_Services["External Services"]
        I[Stripe]
        J[Cronofy Calendar]
        K[Brevo]
        L[Stream]
        M[Google Maps API]
        N[AWS S3 images]
    end

    subgraph Infra
        O[Railway]
    end

    A --> B
    A --> C
    B --> D
    C --> D
    D --> E

    E --> H
    E --> G

    E --> I
    E --> J
    E --> K
    E --> L
    E --> M
    E --> N

    G --> K
    G --> L
    G --> I

    H --> G

    F --> O
```
