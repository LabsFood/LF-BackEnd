import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { User, UserRole } from '../supabase/entities';
import { UsersService } from '../modules/users/users.service';
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
  const adminUser = {
    id: 'user-uuid',
    clerkUserId: 'clerk_admin',
    role: UserRole.ADMIN,
  } as User;

  const buildGuard = (user: User | null) => {
    const users = {
      findByClerkId: jest.fn().mockResolvedValue(user),
    } as unknown as UsersService;
    return { guard: new AdminGuard(users), users };
  };

  it('rejects when Clerk user is missing on the request', async () => {
    const { guard } = buildGuard(adminUser);
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects non-admin persisted users', async () => {
    const { guard } = buildGuard({
      ...adminUser,
      role: UserRole.CLIENT,
    });
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
    const { guard, users } = buildGuard(adminUser);
    const ctx = buildContext({ clerkUser: { userId: 'clerk_admin' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(users.findByClerkId).toHaveBeenCalledWith('clerk_admin');
  });
});
