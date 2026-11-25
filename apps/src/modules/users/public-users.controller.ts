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

import { TAGS } from '../../common/swagger/tags';
import { RegisterUserDto } from './dto/register-user.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { UsersService } from './users.service';

/**
 * Unauthenticated routes. Kept separate from {@link UsersController}, which applies
 * `ClerkAuthGuard` at class level — adding a public route there would mean moving that
 * guard onto eight individual methods, where one missed decorator silently exposes a
 * protected route.
 */
@ApiTags(TAGS.signUp)
@Controller('auth')
export class PublicUsersController {
  constructor(private readonly users: UsersService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Create a client account',
    description:
      'Creates the account with an email and a password, and answers with a one-time ' +
      'sign-in ticket. The web app opens the session with it straight away: ' +
      "`signIn.create({ strategy: 'ticket', ticket })`. Then `PATCH /me/profile` " +
      'completes the profile.\n\n' +
      'The account is always a **client**: a `role` field in the body is refused. ' +
      'Batch cookers get their account through `POST /chef-applications` instead. ' +
      'Limited to 5 accounts per hour per IP address.',
  })
  @ApiCreatedResponse({
    type: RegisterResponseDto,
    description: 'The account, and the ticket to open its session.',
  })
  @ApiBadRequestResponse({
    description:
      'The email is malformed, the password is too weak (12 characters with a lower ' +
      'case, an upper case, a digit and a symbol), the CGU box is not ticked ' +
      '(`acceptTerms` must be `true`), or the body has an unknown field.',
  })
  @ApiConflictResponse({ description: 'This email already has an account.' })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 sign-ups in an hour from this IP.',
  })
  @ApiServiceUnavailableResponse({
    description: 'The server has no Clerk key, so it cannot create accounts.',
  })
  async register(@Body() payload: RegisterUserDto): Promise<RegisterResponseDto> {
    const { user, signInToken, expiresInSeconds } = await this.users.registerClient({
      email: payload.email,
      password: payload.password,
      legalAcceptedAt: new Date(),
    });

    return {
      user: {
        id: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
      signInToken,
      expiresInSeconds,
    };
  }
}
