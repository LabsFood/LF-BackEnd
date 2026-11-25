import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, IsStrongPassword } from 'class-validator';

/**
 * Public sign-up body (form 1). Deliberately limited to credentials:
 * names, address, and profile type are collected by form 2 once a session exists.
 *
 * There is no `role` field by design — `POST /auth/register` always persists
 * `client`. With `forbidNonWhitelisted` enabled globally, a submitted `role`
 * is rejected with 400 rather than silently ignored.
 */
export class RegisterUserDto {
  @ApiProperty({
    format: 'email',
    maxLength: 320,
    description:
      'Email address for the new account. Must be unique in Clerk and Postgres.',
    example: 'marie.dupont@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    minLength: 12,
    description:
      'Password for the new account: at least 12 characters with one lowercase, ' +
      'one uppercase, one number, and one symbol. Clerk applies its own Dashboard ' +
      'policy on top and rejects breached passwords.',
    example: 'Str0ng!UniquePass',
  })
  @IsStrongPassword({
    minLength: 12,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password!: string;

  @ApiProperty({
    description:
      'Ticked the box accepting the CGU and the privacy policy. Must be `true`: ' +
      'Clerk records the consent on the account.',
    example: true,
  })
  @Equals(true)
  acceptTerms!: boolean;
}
