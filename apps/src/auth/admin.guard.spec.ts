import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import type { ClerkUser } from './clerk-auth.guard';

interface FakeRequest {
  clerkUser?: ClerkUser;
}

const buildContext = (req: FakeRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: <T>() => req as unknown as T }),
  }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  const buildGuard = (user: { role: UserRole } | null) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
    } as unknown as PrismaService;
    return { guard: new AdminGuard(prisma), prisma };
  };

  it('rejects when Clerk user is missing on the request', async () => {
    const { guard } = buildGuard({ role: UserRole.admin });
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects non-admin persisted users', async () => {
    const { guard } = buildGuard({ role: UserRole.client });
    await expect(
      guard.canActivate(buildContext({ clerkUser: { userId: 'clerk_admin' } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when no persisted user exists', async () => {
    const { guard } = buildGuard(null);
    await expect(
      guard.canActivate(buildContext({ clerkUser: { userId: 'clerk_unknown' } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows persisted admin users', async () => {
    const { guard, prisma } = buildGuard({ role: UserRole.admin });
    const ctx = buildContext({ clerkUser: { userId: 'clerk_admin' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk_admin' },
      select: { role: true },
    });
  });
});
