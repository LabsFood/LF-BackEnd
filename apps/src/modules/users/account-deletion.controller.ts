import { Controller, Delete, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { AccountDeletionService } from './account-deletion.service';
import { DeletedUserDto, DeleteUserRefusedDto } from './dto/account-deletion.dto';

const WHAT_HAPPENS =
  'The Clerk account is deleted, so the person can no longer sign in. The record here ' +
  'goes too, unless past bookings still reference it: it then stays with its name, ' +
  'email and phone erased (`outcome: anonymised`), and a batch cooker page goes ' +
  'offline.\n\n' +
  'Refused (`409 USER_HAS_OPEN_BOOKINGS`) while a booking of theirs, as client or ' +
  'as batch cooker, is not completed nor cancelled: `bookings` lists them, soonest ' +
  'first, to settle before trying again.';

const REFUSALS =
  '`USER_HAS_OPEN_BOOKINGS`: `bookings` lists what to cancel or complete first. ' +
  '`LAST_ADMIN`: the platform would have no admin left.';

const CLERK_DOWN =
  '`CLERK_NOT_CONFIGURED`: the server has no Clerk key. `CLERK_DELETE_FAILED`: Clerk ' +
  'refused; nothing was changed, try again.';

/** Deleting an account of any role: by its owner, or by an admin. */
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Delete('me')
  @ApiTags(TAGS.me)
  @ApiOperation({ summary: 'Delete my account', description: WHAT_HAPPENS })
  @ApiOkResponse({ type: DeletedUserDto, description: 'The account is deleted.' })
  @ApiConflictResponse({ type: DeleteUserRefusedDto, description: REFUSALS })
  @ApiNotFoundResponse({
    description: '`USER_NOT_FOUND`: no account, or already deleted.',
  })
  @ApiClerkAuthResponses()
  @ApiServiceUnavailableResponse({ description: CLERK_DOWN })
  deleteOwn(@CurrentClerkUser() user: ClerkUser): Promise<DeletedUserDto> {
    return this.deletion.deleteOwn(user.userId);
  }

  @Delete('admin/users/:id')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Delete an account (admin, batch cooker or client)',
    description: `${WHAT_HAPPENS}\n\n\`{id}\` is the account id (\`users.id\`).`,
  })
  @ApiParam({
    name: 'id',
    description: 'The account id (`users.id`).',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiOkResponse({ type: DeletedUserDto, description: 'The account is deleted.' })
  @ApiConflictResponse({ type: DeleteUserRefusedDto, description: REFUSALS })
  @ApiNotFoundResponse({
    description: '`USER_NOT_FOUND`: no account with this id, or already deleted.',
  })
  @ApiAdminAuthResponses()
  @ApiServiceUnavailableResponse({ description: CLERK_DOWN })
  deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClerkUser() user: ClerkUser,
  ): Promise<DeletedUserDto> {
    return this.deletion.deleteByAdmin(id, user.userId);
  }
}
