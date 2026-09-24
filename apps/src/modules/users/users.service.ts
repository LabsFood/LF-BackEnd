import type { UserJSON } from '@clerk/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChefApplicationStatus,
  ClientProfile,
  Prisma,
  User,
  UserRole,
} from '../../generated/prisma/client';

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
      // A deleted account stays deleted: Svix does not guarantee order, and a late
      // user.updated must not bring its personal data back.
      if (existing.deletedAt) return existing;
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

    // ponytail: only an anonymised account is protected. A hard-deleted one leaves
    // no row, so a late user.updated re-creates it with the personal data. Upgrade:
    // anonymise every deleted account instead of deleting it; the row is then the
    // tombstone.
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
   * admin must not be self-assignable. Becoming a batch cooker goes through the
   * candidature flow instead (`POST /chef-applications` then admin approval); there
   * is no self-service promotion.
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

  /**
   * Clerk deleted the account. The row goes, unless bookings still reference it
   * (directly, or through the chef profile and its dishes) and the database refuses
   * to lose that history. The row then stays, emptied of what identifies the person.
   *
   * The delete is tried on its own first: in Postgres, a failed statement aborts
   * the transaction it runs in.
   */
  async deleteByClerkId(clerkUserId: string): Promise<'deleted' | 'anonymised'> {
    try {
      await this.prisma.user.deleteMany({ where: { clerkUserId } });
      return 'deleted';
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
    }

    const user = await this.findByClerkId(clerkUserId);
    if (!user) return 'deleted';
    // ponytail: bookings keep address_line and notes (GDPR art. 17(3)(b), legal
    // retention): services-à-la-personne billing (the tax certificate, URSSAF avance
    // immédiate) needs the client's identity and address for years. No invoicing
    // module yet, so nothing breaks today. When one arrives, copy the client's name
    // onto the booking rather than read it from users.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: `deleted-${user.id}@deleted.invalid`,
          fullName: null,
          phone: null,
          deletedAt: new Date(),
        },
      }),
      this.prisma.clientProfile.deleteMany({ where: { userId: user.id } }),
      // ponytail: the chef's candidature (name, email, phone, address) and identity
      // documents are left as they are. FLOW-01 §8 keeps the documents until the end
      // of the contract plus 5 years, and no end of contract is modelled. Upgrade:
      // take deleted_at as that end and let the dossier job purge them after it.
      this.prisma.chefProfile.updateMany({
        where: { userId: user.id },
        data: {
          displayName: 'Compte supprimé',
          bio: null,
          city: null,
          isActive: false,
          isVerified: false,
        },
      }),
    ]);
    return 'anonymised';
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
   * `PATCH /me/chef-profile` — a verified batch cooker edits their own public profile.
   *
   * Update-only. It never creates a chef profile and never changes `users.role`: the
   * profile is created by submitting a candidature (FLOW-01). This route used to
   * upsert the profile and promote any signed-in client to `chef`; a client calling
   * it now gets a 404 instead.
   *
   * A candidate awaiting approval is browse-only — their candidature and documents
   * are the only things they may act on — so an unverified profile is refused.
   */
  async updateOwnChefProfile(clerkUserId: string, payload: UpdateMeChefProfileDto) {
    const user = await this.findByClerkId(clerkUserId);
    const profile =
      user &&
      (await this.prisma.chefProfile.findUnique({
        where: { userId: user.id },
        select: { id: true, isVerified: true },
      }));
    if (!user || !profile) {
      throw new NotFoundException('No batch cooker profile for this account.');
    }
    if (!profile.isVerified) {
      throw new ForbiddenException({
        code: 'CHEF_NOT_VERIFIED',
        message: 'Your candidature must be approved before you can edit your profile.',
      });
    }

    const { firstName, lastName, phone, ...profileFields } = payload;
    // No role argument, so this can only ever write names and phone.
    await this.applyOwnUserFields(user, { firstName, lastName, phone });

    return this.prisma.chefProfile.update({
      where: { id: profile.id },
      data: profileFields,
    });
  }

  /**
   * Admin switch for a chef's `isVerified` / `isActive` flags.
   *
   * It cannot stand in for approval: a profile born from a candidature is verified
   * only by approving that candidature, which is where the document check lives.
   * Without this, every candidate — who holds a chef profile from submission — would
   * be one call away from verified with no document looked at. A profile with no
   * candidature predates FLOW-01 and keeps the old manual path.
   */
  async setChefVerification(
    chefProfileId: string,
    input: { isVerified?: boolean; isActive?: boolean },
  ) {
    const profile = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: {
        id: true,
        isVerified: true,
        isActive: true,
        application: { select: { status: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException(`Chef profile ${chefProfileId} not found.`);
    }

    const verifies = input.isVerified === true && !profile.isVerified;
    if (
      verifies &&
      profile.application &&
      profile.application.status !== ChefApplicationStatus.approved
    ) {
      throw new ConflictException({
        code: 'APPLICATION_NOT_APPROVED',
        message: 'Verify this batch cooker by approving their candidature.',
      });
    }
    if (
      (input.isActive ?? profile.isActive) &&
      !(input.isVerified ?? profile.isVerified)
    ) {
      throw new ConflictException({
        code: 'CHEF_NOT_VERIFIED',
        message: 'An unverified batch cooker cannot be made active.',
      });
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
   *
   * ponytail: one profile per account. Ceiling: an existing client cannot become a
   * batch cooker without a second account and email (FLOW-01 §10.2). Upgrade path: a
   * client ↔ chef switcher — drop this guard, expose both profiles on `GET /me` — which
   * must ship with a self-dealing guard on bookings and quotes. Decision pending; see
   * `.claude/plans/dual-role-switcher-analysis.md`.
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

  /**
   * `GET /me` — identity plus whatever the frontend needs to route the person.
   *
   * Clients and batch cookers sign in at the same place, so until this responds the
   * user is looking at a waiting screen; the frontend gives up after 6 seconds and
   * falls back to the client space. It is therefore deliberately one indexed read
   * with a single join, and nothing else.
   */
  async currentUser(clerkUserId: string, email?: string) {
    const persisted = await this.ensurePersistedFromClerk(clerkUserId, { email });

    const [chefProfile, hasPassword] = await Promise.all([
      persisted.role === UserRole.chef
        ? this.prisma.chefProfile.findUnique({
            where: { userId: persisted.id },
            select: { id: true, isVerified: true, isActive: true },
          })
        : Promise.resolve(null),
      this.hasClerkPassword(persisted.clerkUserId),
    ]);

    return {
      id: persisted.id,
      clerkUserId: persisted.clerkUserId,
      email: persisted.email,
      fullName: persisted.fullName,
      phone: persisted.phone,
      role: persisted.role,
      hasPassword,
      chefProfile,
    };
  }

  /**
   * Whether the Clerk account has a password yet (FLOW-01 §6: a batch cooker who
   * arrived through the first-login link has not set one).
   *
   * Reports `true` when Clerk is unreachable or unconfigured: the flag only decides
   * whether to show a "choose a password" screen, and wrongly forcing that screen on
   * every user during a Clerk outage is worse than skipping it.
   */
  private async hasClerkPassword(clerkUserId: string): Promise<boolean> {
    if (!this.clerk.configured) return true;
    try {
      const clerkUser = await this.clerk.getClient().users.getUser(clerkUserId);
      return Boolean(clerkUser.passwordEnabled);
    } catch {
      return true;
    }
  }
}

/** Prisma's "a foreign key refused this write" (P2003): here, a RESTRICT from bookings. */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
