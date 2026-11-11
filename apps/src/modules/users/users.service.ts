import type { UserJSON } from '@clerk/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { AuditService } from '../../common/audit/audit.service';
import { ClerkService } from '../../integrations/clerk.service';
import { GeoService } from '../../integrations/geo.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  allergyCheck,
  HEALTH_CONSENT,
  preferencesConsent,
} from '../allergies/domain/allergies.rules';
import { CONTRACT_TERMS } from '../bookings/domain/contract.rules';
import { isValidSiren } from '../chef-onboarding/domain/chef-onboarding.rules';
import { CHEF_LEGAL_SELECT, chefLegalIdentity } from './chef-legal.views';
import { UpdateChefLegalDto } from './dto/chef-legal.dto';
import { chefTierLabels } from '../platform-settings/chef-tiers';
import { clientOnboarding } from './domain/client-onboarding.rules';
import { ListAdminClientsQueryDto } from './dto/admin-client.dto';
import type { AppUserRole } from './dto/admin-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeChefProfileDto } from './dto/chef-profile.dto';
import { UpdateMeSapProfileDto, UpdateSapExternalStatusDto } from './dto/sap-profile.dto';
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

/** The verified batch cooker behind a request made on `/chef/…` or `/me/chef/…`. */
export interface ChefIdentity {
  userId: string;
  chefProfileId: string;
}

/** Row of `GET /admin/clients`: a client account and its profile, if any. */
/** Allergies are health data: on the client's page, never in the list (Recettes lot 1). */
const LIST_OMIT = { allergies: true, customAllergies: true } as const;

export type AdminClientListItem = {
  user: User;
  clientProfile: Omit<ClientProfile, keyof typeof LIST_OMIT> | null;
};

/** Row of `GET /admin/users`: an account, with the id of its client or chef profile. */
export type AdminUserListItem = Pick<
  User,
  | 'id'
  | 'clerkUserId'
  | 'email'
  | 'fullName'
  | 'phone'
  | 'avatarUrl'
  | 'role'
  | 'createdAt'
> & { clientProfileId: string | null; chefProfileId: string | null };

export interface RegisterClientResult {
  user: User;
  signInToken: string;
  expiresInSeconds: number;
}

/**
 * Every email is transactional, so none can be switched off; SMS does not exist yet.
 * ponytail: a constant, not a column. Store it per account the day a channel or a
 * message becomes optional.
 */
const NOTIFICATION_PREFERENCES = { email: true, sms: false } as const;

const clientNotFound = () =>
  new NotFoundException({
    code: 'CLIENT_NOT_FOUND',
    message: 'No client profile with this id.',
  });

/** Identity fields that live on `users`, shared by the client and chef onboarding forms. */
export interface OwnUserFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
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
   * The caller's batch cooker page, which must be approved: custom requests and
   * bookings are work, and a candidate awaiting approval is browse-only.
   */
  async chefIdentity(clerkUserId: string): Promise<ChefIdentity> {
    const user =
      (await this.findByClerkId(clerkUserId)) ??
      (await this.ensurePersistedFromClerk(clerkUserId));
    const profile = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, isVerified: true },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'NOT_A_CHEF',
        message: 'This account has no batch cooker page.',
      });
    }
    if (!profile.isVerified) {
      throw new ForbiddenException({
        code: 'CHEF_NOT_VERIFIED',
        message: 'Only an approved batch cooker can do this.',
      });
    }
    return { userId: user.id, chefProfileId: profile.id };
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
      // The phone is typed in the app (PATCH /me/profile) and never sent to Clerk:
      // Clerk only seeds an empty one, never clears or replaces it.
      if (input.phone && !existing.phone) {
        data.phone = input.phone;
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

  /** LF-0221: the client's "getting started" checklist, derived from what is stored. */
  async clientOnboarding(clerkUserId: string) {
    const user = await this.ensurePersistedFromClerk(clerkUserId);
    const [profile, bookings] = await Promise.all([
      this.prisma.clientProfile.findUnique({
        where: { userId: user.id },
        select: {
          addressStreet: true,
          addressCity: true,
          addressPostalCode: true,
          allergiesDeclaredAt: true,
          dietaryPreferences: true,
          dislikes: true,
          favorites: true,
          spiceLevel: true,
        },
      }),
      this.prisma.booking.count({ where: { clientId: user.id } }),
    ]);
    return clientOnboarding({
      fullName: user.fullName,
      phone: user.phone,
      profile,
      bookings,
    });
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
    const notificationPreferences = NOTIFICATION_PREFERENCES;

    const chef = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
    });
    if (chef) {
      const tierLabels = await chefTierLabels(this.prisma);
      return {
        user,
        profileType: 'chef' as const,
        profile: { ...chef, tierLabel: tierLabels[chef.tier] },
        notificationPreferences,
      };
    }

    const client = await this.prisma.clientProfile.findUnique({
      where: { userId: user.id },
    });
    const check = allergyCheck(client);
    return {
      user,
      profileType: client ? ('client' as const) : ('none' as const),
      profile: client && {
        ...client,
        allergyCheck: check.allergyCheck,
        allergyCheckReasons: check.allergyCheckReasons,
      },
      // The text a client accepts before listing allergies (PUT /me/profile/allergies).
      healthConsent: HEALTH_CONSENT,
      // The booking boxes (CGV art. 5.1), to send back with `consents`.
      contractTerms: CONTRACT_TERMS,
      notificationPreferences,
    };
  }

  /**
   * RGPD (art. 15 and 20): what the person gave the platform, as a file they can keep.
   * Internal ids and payment-provider references stay out: they mean nothing outside.
   *
   * ponytail: account, client profile, bookings, quotes and messages written. Add the
   * chef side, payments and URSSAF links the day someone asks for them.
   */
  async exportMyData(clerkUserId: string) {
    const user = await this.ensurePersistedFromClerk(clerkUserId);
    const address = { addressLine: true, addressCity: true, addressPostalCode: true };
    const [clientProfile, bookings, quotes, messages] = await Promise.all([
      this.prisma.clientProfile.findUnique({
        where: { userId: user.id },
        omit: { id: true, userId: true },
      }),
      this.prisma.booking.findMany({
        where: { clientId: user.id },
        orderBy: { startsAt: 'desc' },
        select: {
          reference: true,
          startsAt: true,
          endsAt: true,
          status: true,
          persons: true,
          amountTtc: true,
          amountAfterTax: true,
          currency: true,
          ...address,
          notes: true,
          createdAt: true,
          chefProfile: { select: { displayName: true } },
        },
      }),
      this.prisma.quote.findMany({
        where: { clientId: user.id },
        orderBy: { createdAt: 'desc' },
        select: {
          reference: true,
          title: true,
          status: true,
          persons: true,
          mealsCount: true,
          cuisine: true,
          diet: true,
          allergies: true,
          brief: true,
          occasion: true,
          desiredDate: true,
          timeSlot: true,
          ...address,
          budgetCents: true,
          quoteAmountTtc: true,
          createdAt: true,
        },
      }),
      this.prisma.message.findMany({
        where: { senderUserId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { body: true, createdAt: true },
      }),
    ]);

    this.logger.log({ event: 'user.data_exported', userId: user.id });
    await this.audit.record({
      actorType: user.role,
      actorUserId: user.id,
      action: 'user.data_exported',
      subjectType: 'user',
      subjectId: user.id,
    });

    return {
      exportedAt: new Date(),
      account: {
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        createdAt: user.createdAt,
      },
      clientProfile,
      bookings,
      quotes,
      messages,
    };
  }

  /**
   * Client onboarding (`PATCH /me/profile`, form 2).
   * Splits user-level identity fields out of the payload before touching
   * `client_profiles`, which has no columns for them.
   */
  async updateProfileByClerkUserId(clerkUserId: string, payload: UpdateMeProfileDto) {
    const { firstName, lastName, phone, consent, consentVersion, ...fields } = payload;

    const user = await this.ensurePersistedFromClerk(clerkUserId);
    await this.assertNoConflictingProfile(user.id, 'client');
    // Politique de confidentialité V1 §5: preferences can reveal health or religion.
    const consentStamp = preferencesConsent(
      fields.dietaryPreferences,
      (await this.prisma.clientProfile.findUnique({
        where: { userId: user.id },
        select: { healthConsentVersion: true },
      })) ?? { healthConsentVersion: null },
      { consent, consentVersion },
      new Date(),
    );
    const profileFields = { ...fields, ...consentStamp };
    // The town must be a commune of the postcode; the half not sent is the one on file.
    if (
      profileFields.addressCity !== undefined ||
      profileFields.addressPostalCode !== undefined
    ) {
      const stored = await this.prisma.clientProfile.findUnique({
        where: { userId: user.id },
        select: { addressCity: true, addressPostalCode: true },
      });
      await this.geo.assertCommune(
        profileFields.addressPostalCode ?? stored?.addressPostalCode,
        profileFields.addressCity ?? stored?.addressCity,
        'addressCity',
      );
    }
    // No role argument: saving a client profile must never change `users.role`.
    await this.applyOwnUserFields(user, { firstName, lastName, phone });

    return this.prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: profileFields,
      create: {
        userId: user.id,
        dietaryPreferences: profileFields.dietaryPreferences ?? [],
        dislikes: profileFields.dislikes ?? [],
        favorites: profileFields.favorites ?? [],
        spiceLevel: profileFields.spiceLevel,
        kitchenNotes: profileFields.kitchenNotes,
        addressStreet: profileFields.addressStreet,
        addressCity: profileFields.addressCity,
        addressPostalCode: profileFields.addressPostalCode,
        householdAdults: profileFields.householdAdults,
        householdKids: profileFields.householdKids,
        ...consentStamp,
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
   * Reads the chef's own SAP declaration (`GET /me/chef-profile/sap`).
   * Returns `null` when the chef has not declared yet; a user without a chef profile
   * is a `ConflictException`, same as on write.
   */
  async getSapProfileByClerkUserId(clerkUserId: string) {
    const chefProfile = await this.requireOwnChefProfile(clerkUserId);
    return this.prisma.sapProfile.findUnique({
      where: { chefProfileId: chefProfile.id },
    });
  }

  /**
   * Chef self-declaration of their "service à la personne" route
   * (`PATCH /me/chef-profile/sap`).
   *
   * Only the declarative fields are writable here. `urssafTiersPrestationStatus` and
   * `crcesuAffiliationStatus` are admin-maintained instead (`setSapExternalStatus`,
   * `PATCH /admin/chefs/:id/sap-external-status`) — the same split as `isActive`/
   * `isVerified` on `chef_profiles`. There is no URSSAF/CRCESU API to write them from, so
   * an admin transcribing the agency's own answer is the only source they can have.
   *
   * Fields belonging to the other declaration type are cleared, so switching from
   * type A to type B cannot leave a stale NOVA code attached to a cooperative chef.
   */
  async updateSapProfileByClerkUserId(
    clerkUserId: string,
    payload: UpdateMeSapProfileDto,
  ) {
    const chefProfile = await this.requireOwnChefProfile(clerkUserId);
    const isTypeA = payload.declarationType === 'type_a_nova';

    const fields = {
      declarationType: payload.declarationType,
      novaCode: isTypeA ? (payload.novaCode ?? null) : null,
      cooperativeName: isTypeA ? null : (payload.cooperativeName ?? null),
      cooperativeMembershipProof: isTypeA
        ? null
        : (payload.cooperativeMembershipProof ?? null),
      crcesuNan: payload.crcesuNan ?? null,
      acceptsCesu: payload.acceptsCesu ?? false,
    };

    return this.prisma.sapProfile.upsert({
      where: { chefProfileId: chefProfile.id },
      update: fields,
      create: { chefProfileId: chefProfile.id, ...fields },
    });
  }

  /**
   * Admin-maintained external SAP statuses (`PATCH /admin/chefs/:id/sap-external-status`).
   *
   * Same split as `isActive` / `isVerified`: a chef declares, an admin habilitates.
   * `crcesuAffiliationStatus` had **no writer at all** before this — there is no CRCESU
   * API to read it from, so an admin transcribing the CRCESU's own answer is the only
   * source it can have.
   *
   * `:id` is the chef profile uuid, and the row has to exist: a status about a
   * declaration that was never made would be meaningless.
   *
   * Audited with both statuses before and after: it is what puts a batch cooker
   * on the CESU circuit, so who said so, and when, has to be answerable.
   */
  async setSapExternalStatus(
    chefProfileId: string,
    payload: UpdateSapExternalStatusDto,
    adminClerkUserId: string,
  ) {
    const statuses = { crcesuAffiliationStatus: true, urssafTiersPrestationStatus: true };
    const [before, admin] = await Promise.all([
      this.prisma.sapProfile.findUnique({ where: { chefProfileId }, select: statuses }),
      this.prisma.user.findUnique({
        where: { clerkUserId: adminClerkUserId },
        select: { id: true },
      }),
    ]);
    if (!before) {
      throw new NotFoundException({
        code: 'SAP_PROFILE_NOT_FOUND',
        message: 'No SAP declaration for this batch cooker: nothing to habilitate yet.',
      });
    }

    const updated = await this.prisma.sapProfile.update({
      where: { chefProfileId },
      data: {
        ...(payload.crcesuAffiliationStatus !== undefined
          ? { crcesuAffiliationStatus: payload.crcesuAffiliationStatus }
          : {}),
        ...(payload.urssafTiersPrestationStatus !== undefined
          ? { urssafTiersPrestationStatus: payload.urssafTiersPrestationStatus }
          : {}),
      },
    });
    const after = {
      crcesuAffiliationStatus: updated.crcesuAffiliationStatus,
      urssafTiersPrestationStatus: updated.urssafTiersPrestationStatus,
    };

    this.logger.log({ event: 'chef.sap_status_changed', chefProfileId, ...after });
    await this.audit.record({
      actorType: 'admin',
      // AdminGuard has just read the admin's row.
      actorUserId: admin?.id ?? null,
      action: 'chef.sap_status_changed',
      subjectType: 'chef_profile',
      subjectId: chefProfileId,
      metadata: { before, after },
    });

    return updated;
  }

  /**
   * The SAP declaration hangs off `chef_profiles`, so onboarding form 2
   * (`PATCH /me/chef-profile`) has to come first.
   */
  /** `GET /me/chef-profile/legal`: the fields as entered, and what is still missing. */
  async getChefLegal(clerkUserId: string) {
    const { id } = await this.requireOwnChefProfile(clerkUserId);
    return this.chefLegalView(id);
  }

  /** `PATCH /me/chef-profile/legal`: CGV art. 3.2, entered by the chef. */
  async updateChefLegal(clerkUserId: string, dto: UpdateChefLegalDto) {
    const { id } = await this.requireOwnChefProfile(clerkUserId);
    if (dto.siren && !isValidSiren(dto.siren)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'siren fails its Luhn key.',
      });
    }
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    await this.prisma.chefProfile.update({ where: { id }, data });
    this.logger.log({
      event: 'chef.legal_updated',
      chefProfileId: id,
      fields: Object.keys(data),
    });
    return this.chefLegalView(id);
  }

  private async chefLegalView(chefProfileId: string) {
    const row = await this.prisma.chefProfile.findUniqueOrThrow({
      where: { id: chefProfileId },
      select: CHEF_LEGAL_SELECT,
    });
    const { sapDeclarationNumber: _sap, sapProfile: _profile, ...fields } = row;
    const identity = chefLegalIdentity(row);
    return { ...fields, sapNumber: identity.sapNumber, missing: identity.missing };
  }

  async requireOwnChefProfile(
    clerkUserId: string,
  ): Promise<{ id: string; userId: string }> {
    const user = await this.ensurePersistedFromClerk(clerkUserId);
    const chefProfile = await this.prisma.chefProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, userId: true },
    });
    if (!chefProfile) {
      throw new ConflictException(
        'No chef profile yet. Complete `PATCH /me/chef-profile` first.',
      );
    }
    return chefProfile;
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
  async assertNoConflictingProfile(
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
   * One page of client accounts, newest sign-up first, with the total for the same
   * filters.
   *
   * Reads `users`, not `client_profiles`: a profile only exists once the client has
   * saved their preferences (`PATCH /me/profile`), so listing profiles hid every
   * client who signed up and never did. Those rows carry `clientProfile: null`, and
   * a `status` filter leaves them out since they have no CRM status yet.
   *
   * `findMany` and `count` run in a single transaction so `meta.total` can never
   * disagree with the rows served — otherwise a concurrent signup between the two
   * queries makes the admin table jump a row mid-pagination.
   *
   * `id` breaks ties on `createdAt`: without it Postgres may order rows sharing a
   * timestamp differently per query, so a row could appear on two pages or on none.
   */
  async listClients(
    query: ListAdminClientsQueryDto = {},
  ): Promise<Paginated<AdminClientListItem>> {
    const bounds = resolvePageBounds(query);
    const where = {
      role: UserRole.client,
      clientProfile: query.status ? { status: query.status } : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { clientProfile: { omit: LIST_OMIT } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(({ clientProfile, ...user }) => ({ user, clientProfile })),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  /**
   * One page of accounts of every role, newest first. Admins have no client or chef
   * profile, so this is the only list that shows them. Accounts deleted in Clerk are
   * left out: their row only stays for the bookings, with its personal data blanked.
   * Same transaction and tiebreaker as `listClients`, for the same reasons.
   */
  async listUsers(query: PaginationQueryDto = {}): Promise<Paginated<AdminUserListItem>> {
    const bounds = resolvePageBounds(query);
    const where = { deletedAt: null };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          clerkUserId: true,
          email: true,
          fullName: true,
          phone: true,
          avatarUrl: true,
          role: true,
          createdAt: true,
          clientProfile: { select: { id: true } },
          chefProfile: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: bounds.skip,
        take: bounds.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(({ clientProfile, chefProfile, ...user }) => ({
        ...user,
        clientProfileId: clientProfile?.id ?? null,
        chefProfileId: chefProfile?.id ?? null,
      })),
      meta: buildPaginationMeta(bounds, total),
    };
  }

  async getClientById(id: string) {
    const client = await this.prisma.clientProfile.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!client) throw clientNotFound();
    return client;
  }

  /**
   * An admin correcting a client's profile on their behalf. Allergies are what the chef
   * cooks around, so who changed what is audited, before and after. The log line names
   * the fields only: diets and allergies are health data.
   */
  async updateClientById(
    id: string,
    payload: UpdateAdminClientDto,
    adminClerkUserId: string,
  ) {
    const fields = Object.keys(payload) as (keyof UpdateAdminClientDto)[];
    const pick = (row: Record<string, unknown>) =>
      Object.fromEntries(fields.map((field) => [field, row[field]]));
    try {
      const [before, admin] = await Promise.all([
        this.prisma.clientProfile.findUnique({ where: { id } }),
        this.prisma.user.findUnique({
          where: { clerkUserId: adminClerkUserId },
          select: { id: true },
        }),
      ]);
      if (!before) throw clientNotFound();

      const updated = await this.prisma.clientProfile.update({
        where: { id },
        data: payload,
        include: { user: true },
      });

      this.logger.log({ event: 'client.profile_updated', clientProfileId: id, fields });
      await this.audit.record({
        actorType: 'admin',
        actorUserId: admin?.id ?? null,
        action: 'client.profile_updated',
        subjectType: 'client_profile',
        subjectId: id,
        metadata: { before: pick(before), after: pick(updated) },
      });
      return updated;
    } catch (error) {
      // Prisma's "no row matched the `where`": a 404, not a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw clientNotFound();
      }
      throw error;
    }
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
      avatarUrl: persisted.avatarUrl,
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
