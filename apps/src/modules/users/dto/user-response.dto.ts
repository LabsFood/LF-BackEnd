import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { CLIENT_STATUS_HELP, CLIENT_STATUSES } from './admin-client.dto';
import { USER_ROLES } from './admin-user.dto';

/** Claims extracted from the Clerk session JWT (no database lookup). */
export class ClerkJwtClaimsDto {
  @ApiProperty({
    description: 'Clerk user identifier from the JWT `sub` claim.',
    example: 'user_2nGxK8abc123',
  })
  user_id!: string;

  @ApiPropertyOptional({
    description: 'Clerk session identifier from the JWT `sid` claim, when present.',
    example: 'sess_2nGxK8abc123',
  })
  session_id?: string;

  @ApiPropertyOptional({
    description:
      'Email address from the JWT when Clerk embeds it. May be absent; prefer `GET /me` for persisted email.',
    example: 'client@example.com',
  })
  email?: string;
}

/** Application user row returned by `GET /me` and admin user endpoints. */
export class CurrentUserDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Postgres primary key (`users.id`). Use this id for `PATCH /admin/users/:id/role`.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  id!: string;

  @ApiProperty({
    description: 'Clerk user id (`users.clerk_user_id`). Matches JWT `sub`.',
    example: 'user_2nGxK8abc123',
  })
  clerkUserId!: string;

  @ApiProperty({
    description: 'Primary email address stored in Postgres.',
    example: 'client@example.com',
  })
  email!: string;

  @ApiProperty({
    nullable: true,
    description: 'Full display name synced from Clerk.',
    example: 'Marie Dupont',
  })
  fullName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Phone number synced from Clerk primary phone, when available.',
    example: '+33612345678',
  })
  phone!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Profile photo, served from Cloudflare R2, for every role. Set through ' +
      '`POST /me/avatar/upload-url` and `/me/avatar/confirm`, never sent directly.',
    example: 'https://photos.labsfood.fr/users/a0eebc99…/avatar/ph_9f2a….jpg',
  })
  avatarUrl!: string | null;

  @ApiProperty({
    enum: USER_ROLES,
    description:
      'Which space this person uses. `client`: orders meals and quotes. `chef`: a batch ' +
      'cooker (see `chefProfile`). `admin`: the back office.',
    example: 'client',
  })
  role!: string;
}

/**
 * `GET /me` — `CurrentUserDto` plus what the shared sign-in page needs to route
 * the person to the right space (FLOW-01 §6).
 *
 * Kept separate from `CurrentUserDto`, which is the generic user shape reused by
 * admin endpoints and by `UserWithProfileDto`.
 */
export class MeResponseDto extends CurrentUserDto {
  @ApiProperty({
    description:
      '`false` while the account has no password, which is the case for a batch cooker ' +
      'who came in through the emailed sign-in link. Show the "choose a password" screen.',
    example: true,
  })
  hasPassword!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      '`null` unless this person is a batch cooker. `isVerified: false`: the candidature ' +
      'is still reviewed, the space is browse-only. `isActive: false`: clients cannot ' +
      'book them yet, even if verified.',
    example: {
      id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      isVerified: false,
      isActive: false,
    },
  })
  chefProfile!: { id: string; isVerified: boolean; isActive: boolean } | null;
}

/** Client taste/preferences profile (`client_profiles` table). */
export class ClientProfileDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The client profile id, used by the `/admin/clients/{id}` routes.',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The account this profile belongs to.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  userId!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Dietary preferences (e.g. vegetarian, halal).',
    example: ['vegetarian'],
  })
  dietaryPreferences?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Known food allergies.',
    example: ['peanuts'],
  })
  allergies?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Ingredients or dishes the client dislikes.',
    example: ['coriandre'],
  })
  dislikes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Preferred dishes or cuisines.',
    example: ['couscous', 'cuisine libanaise'],
  })
  favorites?: string[];

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    description: 'Preferred spice level from 0 (mild) to 10 (very hot).',
    example: 3,
  })
  spiceLevel?: number | null;

  @ApiPropertyOptional({
    description: 'Free-text notes for the chef about the client kitchen or habits.',
    example: 'Plaques à induction, pas de micro-ondes.',
  })
  kitchenNotes?: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Street of the service address. `null` until the client sets it.',
    example: '12 rue de la Paix',
  })
  addressStreet!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'City of the service address. `null` until the client sets it.',
    example: 'Paris',
  })
  addressCity!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Postal code of the service address. `null` until the client sets it.',
    example: '75002',
  })
  addressPostalCode!: string | null;

  @ApiProperty({
    minimum: 1,
    maximum: 20,
    description:
      'Adults in the household, to size portions. `1` until the client sets it.',
    example: 3,
  })
  householdAdults!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 20,
    description: 'Children in the household. `0` until the client sets it.',
    example: 2,
  })
  householdKids!: number;

  @ApiPropertyOptional({
    enum: CLIENT_STATUSES,
    description: CLIENT_STATUS_HELP,
    example: 'active',
  })
  status?: string;
}

/** Chef provider profile (`chef_profiles` table). */
export class ChefProfileDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker page id, used by `/admin/chefs/{id}/verification`.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The account this page belongs to.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  userId!: string;

  @ApiProperty({
    description: 'Public display name shown to clients.',
    example: 'Chef Marie D.',
  })
  displayName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Short public biography.',
    example: 'Cuisine familiale franco-marocaine, 10 ans en restauration.',
  })
  bio?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'City the chef works from.',
    example: 'Lyon',
  })
  city?: string | null;

  @ApiProperty({
    description: 'Distance in kilometres the chef will travel for a session.',
    example: 10,
  })
  serviceRadiusKm!: number;

  @ApiProperty({
    type: [String],
    description:
      'Languages spoken with clients, codes from `GET /referentials/languages`.',
    example: ['fr', 'en'],
  })
  languages!: string[];

  @ApiProperty({
    description:
      'Whether the chef is live and bookable. `false` from candidature submission; ' +
      'set by an admin at approval or later, and only once the chef is verified.',
    example: false,
  })
  isActive!: boolean;

  @ApiProperty({
    description:
      "Whether the chef's candidature was approved. `false` from submission until " +
      'then: the account is browse-only.',
    example: false,
  })
  isVerified!: boolean;
}

/**
 * What the platform notifies by. Read-only: every message is transactional, so
 * none can be switched off. `PATCH /me/profile` refuses this field.
 */
export class NotificationPreferencesDto {
  @ApiProperty({
    description:
      'Always `true`. Every email is transactional (bookings, quotes, candidature, ' +
      'documents, messages) and is sent to the account address.',
    example: true,
  })
  email!: boolean;

  @ApiProperty({
    description: 'Always `false`: SMS is not implemented yet.',
    example: false,
  })
  sms!: boolean;
}

/** `GET /me/profile` — persisted user plus whichever profile matches `users.role`. */
export class UserWithProfileDto {
  @ApiProperty({ type: CurrentUserDto, description: 'Persisted application user.' })
  user!: CurrentUserDto;

  @ApiProperty({
    enum: ['client', 'chef', 'none'],
    description:
      'Which kind of profile `profile` is. `none`: no profile yet, `profile` is `null`.',
    example: 'client',
  })
  profileType!: 'client' | 'chef' | 'none';

  @ApiPropertyOptional({
    oneOf: [
      { $ref: getSchemaPath(ClientProfileDto) },
      { $ref: getSchemaPath(ChefProfileDto) },
    ],
    nullable: true,
    description:
      'A client profile or a batch cooker page, as `profileType` says. `null` when ' +
      '`profileType` is `none`.',
  })
  profile!: ClientProfileDto | ChefProfileDto | null;

  @ApiProperty({
    type: NotificationPreferencesDto,
    description: 'The same for every account, whatever `profileType` is.',
  })
  notificationPreferences!: NotificationPreferencesDto;
}

/** Admin client detail item — profile with nested user. */
export class AdminClientDto extends ClientProfileDto {
  @ApiProperty({
    type: CurrentUserDto,
    description: 'The client account, with its photo in `avatarUrl`.',
  })
  user!: CurrentUserDto;
}

/** `GET /admin/clients` row — a client account and its profile, if any. */
export class AdminClientListItemDto {
  @ApiProperty({ type: CurrentUserDto, description: 'The client account.' })
  user!: CurrentUserDto;

  @ApiProperty({
    type: ClientProfileDto,
    nullable: true,
    description:
      '`null` until the client saves their preferences (`PATCH /me/profile`). ' +
      'Its `id` is the one `GET/PATCH /admin/clients/:id` expects.',
  })
  clientProfile!: ClientProfileDto | null;
}

/** `GET /admin/clients` — one page of client accounts plus its page descriptor. */
export class PaginatedAdminClientsDto {
  @ApiProperty({
    type: [AdminClientListItemDto],
    description: 'Client accounts for the requested page, newest sign-up first.',
  })
  data!: AdminClientListItemDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Page descriptor for the current filters.',
  })
  meta!: PaginationMetaDto;
}
