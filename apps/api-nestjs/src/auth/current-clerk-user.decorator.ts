import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import type { ClerkUser } from './clerk-auth.guard';

export const CurrentClerkUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClerkUser => {
    const req = ctx.switchToHttp().getRequest<{ clerkUser?: ClerkUser }>();
    if (!req.clerkUser) {
      throw new Error('CurrentClerkUser used on a route without ClerkAuthGuard.');
    }
    return req.clerkUser;
  },
);
