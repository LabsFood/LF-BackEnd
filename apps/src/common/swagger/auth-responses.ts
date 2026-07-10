import { applyDecorators } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/** Standard auth failure responses for Clerk-protected routes. */
export function ApiClerkAuthResponses(): MethodDecorator {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description:
        'Missing `Authorization: Bearer` header, malformed JWT, or invalid/expired Clerk session token.',
    }),
    ApiServiceUnavailableResponse({
      description: 'Clerk is not configured (`CLERK_SECRET_KEY` missing).',
    }),
  );
}

/** Auth failures plus admin RBAC rejection. */
export function ApiAdminAuthResponses(): MethodDecorator {
  return applyDecorators(
    ApiClerkAuthResponses(),
    ApiForbiddenResponse({
      description:
        'Authenticated user exists but `users.role` is not `admin` in Postgres.',
    }),
  );
}
