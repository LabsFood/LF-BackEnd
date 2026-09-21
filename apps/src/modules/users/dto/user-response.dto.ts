import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
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
    enum: USER_ROLES,
    description:
      'Application role in Postgres. Source of truth for RBAC (`client`, `chef`, or `admin`).',
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
      'False until a batch cooker who signed in through their first-login link has ' +
      'chosen a password. The frontend uses it to force that screen.',
    example: false,
  })
  hasPassword!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Present for a batch cooker. **Answered even when `isActive` is false**: an ' +
      'unpublished chef must still reach their space to finish their dossier.',
    example: { id: '9a77...', isVerified: true, isActive: false },
  })
  chefProfile!: { id: string; isVerified: boolean; isActive: boolean } | null;
}

/** Client taste/preferences profile (`client_profiles` table). */
export class ClientProfileDto {
  @ApiProperty({ format: 'uuid', description: 'Client profile primary key.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Linked Postgres user id (`users.id`).' })
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
  })
  dislikes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Preferred dishes or cuisines.',
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
  })
  kitchenNotes?: string | null;

  @ApiPropertyOptional({
    enum: ['vip', 'active', 'prospect', 'inactive'],
    description: 'CRM status used by admin client management.',
    example: 'active',
  })
  status?: string;
}

/** Chef provider profile (`chef_profiles` table). */
export class ChefProfileDto {
  @ApiProperty({ format: 'uuid', description: 'Chef profile primary key.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Linked Postgres user id (`users.id`).' })
  userId!: string;

  @ApiProperty({
    description: 'Public display name shown to clients.',
    example: 'Chef Marie D.',
  })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Short public biography.' })
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'City the chef operates from.' })
  city?: string | null;

  @ApiProperty({
    description: 'Distance in kilometres the chef will travel for a session.',
    example: 10,
  })
  serviceRadiusKm!: number;

  @ApiProperty({
    description:
      'Whether the chef is live and bookable. Always `false` on self-registration; ' +
      'only an admin can enable it via `PATCH /admin/chefs/:id/verification`.',
    example: false,
  })
  isActive!: boolean;

  @ApiProperty({
    description:
      'Whether an admin has vetted this chef. Always `false` on self-registration.',
    example: false,
  })
  isVerified!: boolean;
}

/** `GET /me/profile` — persisted user plus whichever profile matches `users.role`. */
export class UserWithProfileDto {
  @ApiProperty({ type: CurrentUserDto, description: 'Persisted application user.' })
  user!: CurrentUserDto;

  @ApiProperty({
    enum: ['client', 'chef', 'none'],
    description:
      'Which profile `profile` holds. `none` when the user has not completed onboarding. ' +
      'Admins report the profile they hold as a user, if any.',
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
      'Client taste profile or chef provider profile, selected by `users.role`. ' +
      '`null` until the user completes onboarding.',
  })
  profile!: ClientProfileDto | ChefProfileDto | null;
}

/** Admin client list/detail item — profile with nested user. */
export class AdminClientDto extends ClientProfileDto {
  @ApiProperty({ type: CurrentUserDto, description: 'Linked application user record.' })
  user!: CurrentUserDto;
}

/** `GET /admin/clients` — one page of client profiles plus its page descriptor. */
export class PaginatedAdminClientsDto {
  @ApiProperty({
    type: [AdminClientDto],
    description: 'Client profiles for the requested page, newest first.',
  })
  data!: AdminClientDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Page descriptor for the current filters.',
  })
  meta!: PaginationMetaDto;
}
