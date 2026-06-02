import { Injectable } from '@nestjs/common';
import { User, UserRole } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdateAdminClientDto, UpdateClientProfileDto } from './dto/profile.dto';

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

  async getProfileByClerkUserId(clerkUserId: string) {
    const user = await this.upsertFromClerk({ clerkUserId });
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId: user.id },
    });
    return { user, profile };
  }

  async updateProfileByClerkUserId(clerkUserId: string, payload: UpdateClientProfileDto) {
    const user = await this.upsertFromClerk({ clerkUserId });
    return this.prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: payload,
      create: {
        userId: user.id,
        dietaryPreferences: payload.dietaryPreferences ?? [],
        allergies: payload.allergies ?? [],
        dislikes: payload.dislikes ?? [],
        favorites: payload.favorites ?? [],
        spiceLevel: payload.spiceLevel,
        kitchenNotes: payload.kitchenNotes,
      },
    });
  }

  listClients(status?: string) {
    return this.prisma.clientProfile.findMany({
      where: status ? { status: status as never } : undefined,
      include: { user: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  getClientById(id: string) {
    return this.prisma.clientProfile.findUnique({
      where: { id },
      include: { user: true },
    });
  }

  updateClientById(id: string, payload: UpdateAdminClientDto) {
    return this.prisma.clientProfile.update({
      where: { id },
      data: {
        ...payload,
        status: payload.status as never,
      },
      include: { user: true },
    });
  }
}
