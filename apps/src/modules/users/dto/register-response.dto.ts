import { ApiProperty } from '@nestjs/swagger';

import { CurrentUserDto } from './user-response.dto';

/**
 * Response of `POST /auth/register`.
 *
 * Server-side Clerk user creation (BAPI) does not establish a browser session, so
 * the frontend redeems `signInToken` via `signIn.create({ strategy: 'ticket', ticket })`
 * to activate one. That is what lets form 2 hit the authenticated `PATCH /me/profile`
 * without asking the user to sign in again.
 */
export class RegisterResponseDto {
  @ApiProperty({
    type: CurrentUserDto,
    description:
      'Newly created application user. `role` is always `client` on this route.',
  })
  user!: CurrentUserDto;

  @ApiProperty({
    description:
      'Single-use Clerk sign-in ticket. Redeem immediately with ' +
      "`signIn.create({ strategy: 'ticket', ticket })`. Treat as a credential: " +
      'never log it, never persist it, never put it in a URL.',
    example: 'sit_2nGxK8abc123',
  })
  signInToken!: string;

  @ApiProperty({
    description: 'Seconds until `signInToken` expires.',
    example: 60,
  })
  expiresInSeconds!: number;
}
