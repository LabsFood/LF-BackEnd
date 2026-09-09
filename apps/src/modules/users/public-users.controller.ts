import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';

import { RegisterUserDto } from './dto/register-user.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { UsersService } from './users.service';

/**
 * Unauthenticated routes. Kept separate from {@link UsersController}, which applies
 * `ClerkAuthGuard` at class level — adding a public route there would mean moving that
 * guard onto eight individual methods, where one missed decorator silently exposes a
 * protected route.
 */
@ApiTags('auth')
@Controller('auth')
export class PublicUsersController {
  constructor(private readonly users: UsersService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Public: register a new client account',
    description:
      'Creates a Clerk account and the matching Postgres `users` row, then returns a ' +
      'single-use sign-in ticket the frontend redeems with ' +
      "`signIn.create({ strategy: 'ticket', ticket })` to activate a session. " +
      'The new user is always `role: client`; sending a `role` field is rejected with 400. ' +
      'Requires a real `CLERK_SECRET_KEY`. Note that Clerk Backend API auto-verifies the ' +
      'email address, so no verification mail is sent on this path.',
  })
  @ApiCreatedResponse({
    type: RegisterResponseDto,
    description: 'Created user plus a short-lived Clerk sign-in ticket.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed: malformed email, password below policy, or an unexpected ' +
      'field such as `role` was submitted.',
  })
  @ApiConflictResponse({
    description: 'Email is already registered in Postgres or Clerk.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Registration rate limit exceeded for this IP.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Clerk Backend API is not configured (`sk_test_placeholder` or missing secret key).',
  })
  async register(@Body() payload: RegisterUserDto): Promise<RegisterResponseDto> {
    const { user, signInToken, expiresInSeconds } = await this.users.registerClient({
      email: payload.email,
      password: payload.password,
    });

    return {
      user: {
        id: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
      },
      signInToken,
      expiresInSeconds,
    };
  }
}
