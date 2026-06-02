import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ClerkUser } from './clerk-auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ clerkUser?: ClerkUser }>();
    const clerkUser = req.clerkUser;
    if (!clerkUser?.userId) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { clerkUserId: clerkUser.userId },
      select: { role: true },
    });
    if (!user || user.role !== UserRole.admin) {
      throw new ForbiddenException('Admin role required.');
    }

    return true;
  }
}
