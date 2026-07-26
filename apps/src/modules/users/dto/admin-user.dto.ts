import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const USER_ROLES = ['client', 'chef', 'admin'] as const;
export type AppUserRole = (typeof USER_ROLES)[number];

export class CreateAdminUserDto {
  @ApiProperty({
    example: 'chef@labsfood.fr',
    description: 'Primary email address for the new Clerk account. Must be unique in Clerk.',
  })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    minLength: 8,
    description:
      'Initial password for the Clerk account. Omit to create a passwordless user ' +
      '(they complete sign-in via Clerk UI / magic link). Must meet Clerk password policy.',
    example: 'Str0ng!UniquePass',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    description: 'First name stored in Clerk and used to build `fullName` in Postgres.',
    example: 'Marie',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Last name stored in Clerk and used to build `fullName` in Postgres.',
    example: 'Dupont',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    enum: USER_ROLES,
    default: 'client',
    description:
      'Application role persisted in Postgres. Defaults to `client` when omitted. ' +
      'Use `chef` for kitchen staff, `admin` for back-office operators.',
    example: 'client',
  })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: AppUserRole;
}

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: USER_ROLES,
    description:
      'New application role written to Postgres (`users.role`). ' +
      'This is the RBAC source of truth for guards and feature access.',
    example: 'admin',
  })
  @IsIn(USER_ROLES)
  role!: AppUserRole;
}
