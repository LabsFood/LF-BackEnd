import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    description: 'Postgres primary key (`users.id`). Use this id for `PATCH /admin/users/:id/role`.',
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

/** `GET /me/profile` — persisted user plus optional client profile. */
export class UserWithProfileDto {
  @ApiProperty({ type: CurrentUserDto, description: 'Persisted application user.' })
  user!: CurrentUserDto;

  @ApiPropertyOptional({
    type: ClientProfileDto,
    nullable: true,
    description: 'Client taste profile. `null` until the client completes onboarding.',
  })
  profile!: ClientProfileDto | null;
}

/** Admin client list/detail item — profile with nested user. */
export class AdminClientDto extends ClientProfileDto {
  @ApiProperty({ type: CurrentUserDto, description: 'Linked application user record.' })
  user!: CurrentUserDto;
}
