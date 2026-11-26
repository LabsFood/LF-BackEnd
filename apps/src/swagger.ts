import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type {
  MediaTypeObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

import { TAG_DESCRIPTIONS, TAGS } from './common/swagger/tags';

/** The guide at the top of `/docs`: what a newcomer needs before reading any route. */
const GUIDE = `
The Lab's Food API: accounts, batch cooker onboarding, catalog, bookings and quotes.

## Signing in

Routes with a lock need a Clerk session token in the header
\`Authorization: Bearer <token>\`. The web app gets it from Clerk with \`getToken()\`.
To try those routes here, click **Authorize** and paste a token. Routes without a lock are public.

## Roles

The role is stored by this API (\`users.role\`), not in the token. \`GET /me\` returns it.

- **client**: the default. Orders meals and requests quotes.
- **chef** (batch cooker): created by \`POST /chef-applications\`. Until an admin approves the
  candidature, the account can only follow it and upload documents.
- **admin**: the back office, every \`/admin\` route. Never self-assigned.

## Main flows

**A client signs up**
1. \`POST /auth/register\` with an email and a password. The answer holds a one-time sign-in ticket.
2. The web app opens a session with it: \`signIn.create({ strategy: 'ticket', ticket })\`.
3. \`PATCH /me/profile\` saves tastes, address and household.

**Someone becomes a batch cooker**
1. \`POST /chef-applications\` sends the form. The account is created and a sign-in link is emailed.
2. Signed in, \`GET /me/chef-documents\` lists the documents to provide. Each one is uploaded in
   three steps: \`upload-url\`, then PUT the file to that URL, then \`confirm\`.
3. An admin checks each document, then approves the candidature.

## Conventions

- Ids are UUIDs. Times are ISO 8601 (\`2026-09-20T09:12:03.412Z\`), days are \`YYYY-MM-DD\`.
- Choices are lower-case. Batch cooker routes write them in kebab-case (\`changes-requested\`);
  older routes use the database spelling (\`in_review\`).
- Lists that grow are paginated with \`?page=1&limit=20\` (100 at most), and answer
  \`{ data, meta }\`.
- Routes marked \`x-requires-approved-chef\` answer \`403 CHEF_NOT_VERIFIED\` until the batch
  cooker's candidature is approved; reads that are not marked stay open.
- A malformed request answers \`400\` with the list of problems in \`message\`, and the same
  problems field by field in \`errors\` (\`{ field, code, message }\`). A broken business
  rule answers with a stable \`code\` to branch on, for example
  \`409 { "code": "EMAIL_ALREADY_USED", "message": "…" }\`.
`.trim();

/**
 * The OpenAPI document served at `/docs` and `/openapi.json`. Kept out of `main.ts`
 * so the same document can be built without starting the server.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Lab’s Food API')
    .setDescription(GUIDE)
    .setVersion('1.3.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'A Clerk session token, from `getToken()` in the web app.',
    });

  // Registering every section here fixes their order in Swagger UI.
  for (const key of Object.keys(TAGS) as (keyof typeof TAGS)[]) {
    builder.addTag(TAGS[key], TAG_DESCRIPTIONS[key]);
  }

  // Every route names its section; without this, a controller with no class-level
  // tag also lands in a section named after the class ("Users", "Catalog"…).
  const document = SwaggerModule.createDocument(app, builder.build(), {
    autoTagControllers: false,
  });
  return withSchemasFromExamples(document);
}

/**
 * The JSON schema an example shows: every key it has is required, a `null` is a
 * nullable value of unknown type, an array is typed by its first item.
 */
export function schemaOf(value: unknown): SchemaObject {
  if (value === null || value === undefined) return { nullable: true };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? schemaOf(value[0]) : {} };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, item]) => [key, schemaOf(item)])),
      required: entries.map(([key]) => key),
    };
  }
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return {};
}

/**
 * Most 2xx answers are documented by an example only, which leaves a generated
 * client with `unknown`. Each such answer gets the schema its example shows, marked
 * `x-schema-from-example`. A route documented with a DTO keeps its own schema.
 */
// ponytail: schemas read off examples are as right as the examples; move a route to a
// response DTO when its example cannot show the shape (unions, audience-specific keys).
export function withSchemasFromExamples(document: OpenAPIObject): OpenAPIObject {
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Record<string, unknown> })?.responses;
      for (const [status, response] of Object.entries(responses ?? {})) {
        if (!status.startsWith('2')) continue;
        const content = (response as { content?: Record<string, MediaTypeObject> })
          .content;
        for (const media of Object.values(content ?? {})) {
          if (media.schema) continue;
          const named = Object.values(media.examples ?? {})[0] as { value?: unknown };
          const example: unknown = media.example ?? named?.value;
          if (example === undefined) continue;
          media.schema = {
            ...schemaOf(example),
            'x-schema-from-example': true,
          } as SchemaObject;
        }
      }
      // DEM-06: a candidate awaiting approval is refused here; the screen can say so first.
      const forbidden = responses?.['403'] as { description?: string } | undefined;
      if (forbidden?.description?.includes('CHEF_NOT_VERIFIED')) {
        (operation as Record<string, unknown>)['x-requires-approved-chef'] = true;
      }
    }
  }
  return document;
}
