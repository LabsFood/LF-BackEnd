import { Injectable } from '@nestjs/common';
import { User, UserRole } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertFromClerkInput {
  clerkUserId: string;
  email?: string;
  fullName?: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByClerkId(clerkUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { clerkUserId } });
  }

  /** Get-or-create a `users` row keyed by Clerk subject. */
  async upsertFromClerk(input: UpsertFromClerkInput): Promise<User> {
    const existing = await this.findByClerkId(input.clerkUserId);
    if (existing) {
      const email = input.email && existing.email !== input.email ? input.email : undefined;
      const fullName =
        input.fullName !== undefined && existing.fullName !== input.fullName
          ? (input.fullName ?? null)
          : undefined;

      if (email !== undefined || fullName !== undefined) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { email, fullName },
        });
      }
      return existing;
    }

    return this.prisma.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        email: input.email ?? `${input.clerkUserId}@unknown.invalid`,
        fullName: input.fullName ?? null,
        role: UserRole.client,
      },
    });
  }
}
