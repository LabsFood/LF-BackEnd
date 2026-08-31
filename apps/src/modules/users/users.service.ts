import type { UserJSON } from '@clerk/backend';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProfile, User, UserRole } from '../../generated/prisma/client';

import {
  clerkProfileFromBapiUser,
  clerkProfileFromUserJson,
  type ClerkProfileFields,
} from '../../auth/clerk-user-payload';
import {
  buildPaginationMeta,
  resolvePageBounds,
  type Paginated,
} from '../../common/dto/pagination.dto';
import { ClerkService } from '../../integrations/clerk.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAdminClientsQueryDto } from './dto/admin-client.dto';
import type { AppUserRole } from './dto/admin-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeChefProfileDto } from './dto/chef-profile.dto';
import { UpdateAdminClientDto, UpdateMeProfileDto } from './dto/profile.dto';

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

export interface RegisterClientInput {
  email: string;
  password: string;
}

/** Row shape returned by the admin client endpoints (profile + nested user). */
export type ClientProfileWithUser = ClientProfile & { user: User };

export interface RegisterClientResult {
  user: User;
  signInToken: string;
  expiresInSeconds: number;
}

/** Identity fields that live on `users`, shared by the client and chef onboarding forms. */
export interface OwnUserFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
    private readonly config: ConfigService,
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
   * BAPI auto-verifies email addresses (Clerk limitation for server-side creation).
   */
  private async createClerkUserAndPersist(
    input: ProvisionAdminUserInput,
    role: UserRole,
  ): Promise<User> {
    if (!this.clerk.configured) {
      throw new ServiceUnavailableException(
        'Clerk user creation requires a real CLERK_SECRET_KEY (not sk_test_placeholder).',
      );
    }

    // Check Postgres first: creating in Clerk before finding out the email is already
    // taken locally would leave an orphaned Clerk account with no matching users row.
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Email ${input.email} is already registered.`);
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
      role,
    });
  }

  /** Admin-driven provisioning. Role comes from the authenticated admin's request. */
  provisionAdminUser(input: ProvisionAdminUserInput): Promise<User> {
    return this.createClerkUserAndPersist(input, input.role ?? UserRole.client);
  }

  /**
   * Public self-service sign-up (`POST /auth/register`, form 1).
   *
   * The role is hard-coded to `client` and is never read from the request — chef and
   * admin must not be self-assignable. A user who chooses "chef" in form 2 is promoted
   * by `updateChefProfileByClerkUserId`, which lands them unverified and inactive.
   *
   * Server-side creation establishes no browser session, so a short-lived sign-in
   * ticket is returned for the frontend to redeem.
   */
  async registerClient(input: RegisterClientInput): Promise<RegisterClientResult> {
    const user = await this.createClerkUserAndPersist(
      { email: input.email, password: input.password },
      UserRole.client,
    );

    const expiresInSeconds = this.config.get<number>('clerk.signInTokenTtlSeconds', 3600);
    const { token } = await this.clerk.getClient().signInTokens.createSignInToken({
      userId: user.clerkUserId,
      expiresInSeconds,
    });

    return { user, signInToken: token, expiresInSeconds };
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

  /**
   * Returns whichever profile row the user actually holds.
   *
   * Resolved from the data rather than from `users.role`: onboarding no longer forces
   * the role to match the profile, so an admin may hold a chef profile while keeping
   * `admin`. Branching on the role would report `none` for that user despite the row
   * existing. The second query only runs when the first misses.
   */
  async getProfileByClerkUserId(clerkUserId: string) {
    const user = await this.ensurePersistedFromClerk(clerkUserId);

    const chef = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
    });
    if (chef) {
      return { user, profileType: 'chef' as const, profile: chef };
    }

    const client = await this.prisma.clientProfile.findUnique({
      where: { userId: user.id },
    });
    return {
      user,
      profileType: client ? ('client' as const) : ('none' as const),
      profile: client,
    };
  }

  /**
   * Client onboarding (`PATCH /me/profile`, form 2).
   * Splits user-level identity fields out of the payload before touching
   * `client_profiles`, which has no columns for them.
   */
  async updateProfileByClerkUserId(clerkUserId: string, payload: UpdateMeProfileDto) {
    const { firstName, lastName, phone, ...profileFields } = payload;

    const user = await this.ensurePersistedFromClerk(clerkUserId);
    await this.assertNoConflictingProfile(user.id, 'client');
    // No role argument: saving a client profile must never change `users.role`.
    await this.applyOwnUserFields(user, { firstName, lastName, phone });

    return this.prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: profileFields,
      create: {
        userId: user.id,
        dietaryPreferences: profileFields.dietaryPreferences ?? [],
        allergies: profileFields.allergies ?? [],
        dislikes: profileFields.dislikes ?? [],
        favorites: profileFields.favorites ?? [],
        spiceLevel: profileFields.spiceLevel,
        kitchenNotes: profileFields.kitchenNotes,
        addressStreet: profileFields.addressStreet,
        addressCity: profileFields.addressCity,
        addressPostalCode: profileFields.addressPostalCode,
        householdAdults: profileFields.householdAdults,
        householdKids: profileFields.householdKids,
      },
    });
  }

  /**
   * Chef onboarding (`PATCH /me/chef-profile`, form 2).
   *
   * Promotes `users.role` to `chef` — the route is what selects the role, never the
   * request body. The profile is always created inactive and unverified; only
   * {@link setChefVerification} can change that.
   */
  async updateChefProfileByClerkUserId(
    clerkUserId: string,
    payload: UpdateMeChefProfileDto,
  ) {
    const { firstName, lastName, phone, ...profileFields } = payload;

    const user = await this.ensurePersistedFromClerk(clerkUserId);
    await this.assertNoConflictingProfile(user.id, 'chef');
    // Promote out of `client` only. An admin filling in a chef profile keeps `admin`,
    // and an existing chef is left alone — onboarding never demotes.
    const promoteTo = user.role === UserRole.client ? UserRole.chef : undefined;
    await this.applyOwnUserFields(user, { firstName, lastName, phone }, promoteTo);

    return this.prisma.chefProfile.upsert({
      where: { userId: user.id },
      update: profileFields,
      create: {
        userId: user.id,
        displayName: profileFields.displayName,
        bio: profileFields.bio,
        city: profileFields.city,
        serviceRadiusKm: profileFields.serviceRadiusKm ?? 10,
        // Never settable from a self-service request — admin vetting owns these.
        isActive: false,
        isVerified: false,
      },
    });
  }

  /** Admin vetting gate for chefs. The only path that may set `isActive`/`isVerified`. */
  async setChefVerification(
    chefProfileId: string,
    input: { isVerified?: boolean; isActive?: boolean },
  ) {
    const profile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }

    return this.prisma.chefProfile.update({
      where: { id: chefProfileId },
      data: input,
      include: { user: true },
    });
  }

  /**
   * Switching profile type after onboarding is deliberately blocked for now; it needs
   * reconciliation of the orphaned profile, bookings, and payouts. Tracked as separate
   * work — the schema already supports both rows existing, so this is the only guard.
   */
  private async assertNoConflictingProfile(
    userId: string,
    target: 'client' | 'chef',
  ): Promise<void> {
    const other =
      target === 'client'
        ? await this.prisma.chefProfile.findUnique({
            where: { userId },
            select: { id: true },
          })
        : await this.prisma.clientProfile.findUnique({
            where: { userId },
            select: { id: true },
          });

    if (other) {
      throw new ConflictException(
        `User already has a ${target === 'client' ? 'chef' : 'client'} profile. ` +
          'Switching profile type is not supported yet.',
      );
    }
  }

  /** Writes shared identity fields to `users` and mirrors names into Clerk. */
  /**
   * Writes shared identity fields to `users` and mirrors names into Clerk.
   *
   * `role` is only written when a caller explicitly passes one. Onboarding must not
   * assert a default role: `client` is already applied at row creation
   * (`POST /auth/register` and the `upsertFromClerk` create path), so re-asserting it
   * here would demote an existing admin or chef who edits their own profile.
   */
  private async applyOwnUserFields(
    user: User,
    fields: OwnUserFields,
    role?: UserRole,
  ): Promise<void> {
    const fullName =
      [fields.firstName, fields.lastName].filter(Boolean).join(' ') || undefined;

    const data: { fullName?: string; phone?: string; role?: UserRole } = {};
    if (fullName && fullName !== user.fullName) data.fullName = fullName;
    if (fields.phone && fields.phone !== user.phone) data.phone = fields.phone;
    if (role !== undefined && user.role !== role) data.role = role;

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data });
    }

    if ((fields.firstName || fields.lastName) && this.clerk.configured) {
      await this.syncClerkNames(user.clerkUserId, fields);
    }
  }

  private async syncClerkNames(
    clerkUserId: string,
    fields: OwnUserFields,
  ): Promise<void> {
    try {
      await this.clerk.getClient().users.updateUser(clerkUserId, {
        ...(fields.firstName ? { firstName: fields.firstName } : {}),
        ...(fields.lastName ? { lastName: fields.lastName } : {}),
      });
    } catch {
      // Postgres is the source of truth; Clerk name sync is best-effort visibility.
    }
  }

  /**
   * One page of client profiles, newest first, with the total for the same filters.
   *
   * `findMany` and `count` run in a single transaction so `meta.total` can never
   * disagree with the rows served — otherwise a concurrent signup between the two
   * queries makes the admin table jump a row mid-pagination.
   *
   * `id` breaks ties on `updatedAt`: without it Postgres may order rows sharing a
   * timestamp differently per query, so a row could appear on two pages or on none.
   */
  async listClients(
    query: ListAdminClientsQueryDto = {},
  ): Promise<Paginated<ClientProfileWithUser>> {
    const bounds = resolvePageBounds(query);
    const where = query.status ? { status: query.status } : undefined;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientProfile.findMany({
        where,
        include: { user: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.clientProfile.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(bounds, total) };
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
