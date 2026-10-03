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
      description: 'No token, or the token is invalid or expired. Sign in again.',
    }),
    ApiServiceUnavailableResponse({
      description: 'The server has no Clerk key, so it cannot check tokens.',
    }),
  );
}

/** Auth failures plus admin RBAC rejection. */
export function ApiAdminAuthResponses(): MethodDecorator {
  return applyDecorators(
    ApiClerkAuthResponses(),
    ApiForbiddenResponse({
      description: 'Signed in, but not an admin.',
    }),
  );
}
