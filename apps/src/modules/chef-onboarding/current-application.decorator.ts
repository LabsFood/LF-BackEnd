import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { ChefApplication } from '../../generated/prisma/client';
import type { ApplicationRequest } from './application-token.guard';

/** The candidature resolved by `ApplicationTokenGuard`. */
export const CurrentApplication = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ChefApplication =>
    context.switchToHttp().getRequest<ApplicationRequest>().chefApplication!,
);
