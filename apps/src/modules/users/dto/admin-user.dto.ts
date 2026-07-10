import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const USER_ROLES = ['client', 'chef', 'admin'] as const;
export type AppUserRole = (typeof USER_ROLES)[number];

export class CreateAdminUserDto {
  @ApiProperty({ example: 'chef@labsfood.fr' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'Omit to create a passwordless account.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: USER_ROLES, default: 'client' })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: AppUserRole;
}

export class UpdateUserRoleDto {
  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: AppUserRole;
}
