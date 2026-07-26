import type { UserJSON } from '@clerk/backend';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { User, UserRole } from '../../generated/prisma/client';

import {
  clerkProfileFromBapiUser,
  clerkProfileFromUserJson,
  type ClerkProfileFields,
} from '../../auth/clerk-user-payload';
import { ClerkService } from '../../integrations/clerk.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppUserRole } from './dto/admin-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateAdminClientDto, UpdateClientProfileDto } from './dto/profile.dto';

export interface UpsertFromClerkInput {
  clerkUserId: string;
  email?: string;
  fullName?: string | null;
  phone?: string | null;
  role?: UserRole;
}

export interface ClerkJwtHints {
  email?: string;
}

export interface CreateWithRoleInput {
  clerkUserId: string;
  email: string;
  fullName?: string | null;
  role: UserRole;
}

export interface ProvisionAdminUserInput {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
  ) {}

  private createPersistedUser(
    input: CreateUserDto & { fullName?: string | null; role: UserRole },
  ): Promise<User> {
    return this.prisma.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        email: input.email,
        fullName: input.fullName ?? null,
        role: input.role,
      },
    });
  }

  createUser(input: CreateUserDto): Promise<User> {
    return this.createPersistedUser({ ...input, role: UserRole.client });
  }

  createAdmin(input: CreateUserDto): Promise<User> {
    return this.createPersistedUser({ ...input, role: UserRole.admin });
  }

  findByClerkId(clerkUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { clerkUserId } });
  }

  /**
   * Get-or-create a `users` row keyed by Clerk subject.
   * When Clerk BAPI is configured, enriches email, fullName, and phone from Clerk
   * before persisting (JWT hints used as fallback in stub mode or on BAPI miss).
   */
  async ensurePersistedFromClerk(
    clerkUserId: string,
    jwtHints: ClerkJwtHints = {},
  ): Promise<User> {
    const input = await this.resolveUpsertInput(clerkUserId, jwtHints);
    return this.upsertFromClerk(input);
  }

  /** Get-or-create a `users` row keyed by Clerk subject. */
  async upsertFromClerk(input: UpsertFromClerkInput): Promise<User> {
    const existing = await this.findByClerkId(input.clerkUserId);
    if (existing) {
      const data: {
        email?: string;
        fullName?: string | null;
        phone?: string | null;
        role?: UserRole;
      } = {};
      if (input.email && existing.email !== input.email) {
        data.email = input.email;
      }
      if (input.fullName !== undefined && existing.fullName !== input.fullName) {
        data.fullName = input.fullName ?? null;
      }
      if (input.phone !== undefined && existing.phone !== input.phone) {
        data.phone = input.phone ?? null;
      }
      if (input.role !== undefined && existing.role !== input.role) {
        data.role = input.role;
      }

      if (Object.keys(data).length > 0) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data,
        });
      }
      return existing;
    }

    return this.prisma.user.create({
      data: {
        clerkUserId: input.clerkUserId,
        email: input.email ?? `${input.clerkUserId}@unknown.invalid`,
        fullName: input.fullName ?? null,
        phone: input.phone ?? null,
        role: input.role ?? UserRole.client,
      },
    });
  }

  /** Persist a user row with an explicit role (admin provisioning or post-Clerk create). */
  async createWithRole(input: CreateWithRoleInput): Promise<User> {
    return this.upsertFromClerk({
      clerkUserId: input.clerkUserId,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
    });
  }

  async updateRole(userId: string, role: UserRole): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    const synced = await this.ensurePersistedFromClerk(user.clerkUserId);

    const updated = await this.prisma.user.update({
      where: { id: synced.id },
      data: { role },
    });

    if (this.clerk.configured) {
      await this.syncClerkPublicRole(user.clerkUserId, role);
    }

    return updated;
  }

  /**
   * Create a Clerk user via BAPI and persist in Postgres with the requested role.
   * BAPI auto-verifies email addresses (Clerk limitation for admin provisioning).
   */
  async provisionAdminUser(input: ProvisionAdminUserInput): Promise<User> {
    if (!this.clerk.configured) {
      throw new ServiceUnavailableException(
        'Clerk admin provisioning requires a real CLERK_SECRET_KEY (not sk_test_placeholder).',
      );
    }

    const clerk = this.clerk.getClient();
    let clerkUser;
    try {
      clerkUser = await clerk.users.createUser({
        emailAddress: [input.email],
        ...(input.password ? { password: input.password } : {}),
        firstName: input.firstName,
        lastName: input.lastName,
        skipPasswordRequirement: !input.password,
      });
    } catch (error) {
      this.throwMappedClerkError(error);
    }

    const fullName = [input.firstName, input.lastName].filter(Boolean).join(' ') || null;

    return this.createWithRole({
      clerkUserId: clerkUser.id,
      email: input.email,
      fullName,
      role: input.role ?? UserRole.client,
    });
  }

  upsertFromClerkUserJson(user: UserJSON): Promise<User> {
    return this.upsertFromClerk({
      clerkUserId: user.id,
      ...clerkProfileFromUserJson(user),
    });
  }

  async deleteByClerkId(clerkUserId: string): Promise<void> {
    await this.prisma.user.deleteMany({ where: { clerkUserId } });
  }

  async getProfileByClerkUserId(clerkUserId: string) {
    const user = await this.ensurePersistedFromClerk(clerkUserId);
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId: user.id },
    });
    return { user, profile };
  }

  async updateProfileByClerkUserId(clerkUserId: string, payload: UpdateClientProfileDto) {
    const user = await this.ensurePersistedFromClerk(clerkUserId);
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

  toUserRole(role: AppUserRole): UserRole {
    return role as UserRole;
  }

  private async resolveUpsertInput(
    clerkUserId: string,
    jwtHints: ClerkJwtHints,
  ): Promise<UpsertFromClerkInput> {
    if (this.clerk.configured) {
      try {
        const clerkUser = await this.clerk.getClient().users.getUser(clerkUserId);
        const profile = clerkProfileFromBapiUser(clerkUser);
        return this.mergeUpsertInput(clerkUserId, profile, jwtHints);
      } catch {
        // Fall back to JWT hints when BAPI lookup fails (deleted user, network, etc.).
      }
    }

    return this.mergeUpsertInput(clerkUserId, {}, jwtHints);
  }

  private mergeUpsertInput(
    clerkUserId: string,
    profile: ClerkProfileFields,
    jwtHints: ClerkJwtHints,
  ): UpsertFromClerkInput {
    return {
      clerkUserId,
      email: profile.email ?? jwtHints.email,
      fullName: profile.fullName,
      phone: profile.phone,
    };
  }

  private async syncClerkPublicRole(clerkUserId: string, role: UserRole): Promise<void> {
    try {
      const clerk = this.clerk.getClient();
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const existingMeta = (clerkUser.publicMetadata ?? {}) as Record<string, unknown>;
      await clerk.users.updateUser(clerkUserId, {
        publicMetadata: { ...existingMeta, role },
      });
    } catch {
      // Postgres is the RBAC source of truth; Clerk metadata is optional visibility.
    }
  }

  private throwMappedClerkError(error: unknown): never {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      const message =
        error instanceof Error ? error.message : 'Clerk user creation failed.';
      if (status === 409) {
        throw new ConflictException(message);
      }
      if (status === 400 || status === 422) {
        throw new BadRequestException(message);
      }
    }
    throw error;
  }
}
