import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { UserRole } from '../supabase/entities';
import { UsersService } from '../modules/users/users.service';
import type { ClerkUser } from './clerk-auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ clerkUser?: ClerkUser }>();
    const clerkUser = req.clerkUser;
    if (!clerkUser?.userId) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = await this.users.findByClerkId(clerkUser.userId);
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required.');
    }

    return true;
  }
}
