import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('thisUser')
  @ApiOkResponse({ description: 'Authenticated Clerk user identifiers.' })
  thisUser(@CurrentClerkUser() user: ClerkUser): {
    user_id: string;
    session_id?: string;
    email?: string;
  } {
    return {
      user_id: user.userId,
      session_id: user.sessionId,
      email: user.email,
    };
  }

  @Get('me')
  @ApiOkResponse({ description: 'Returns the persisted user mapped from Clerk subject.' })
  async me(@CurrentClerkUser() user: ClerkUser): Promise<{
    id: string;
    clerkUserId: string;
    email: string;
    fullName: string | null;
    role: string;
  }> {
    const persisted = await this.users.upsertFromClerk({
      clerkUserId: user.userId,
      email: user.email,
    });
    return {
      id: persisted.id,
      clerkUserId: persisted.clerkUserId,
      email: persisted.email,
      fullName: persisted.fullName,
      role: persisted.role,
    };
  }
}
