import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  PHOTO_UPLOAD_EXAMPLE,
  PhotoConfirmDto,
  PhotoUploadDto,
  photoStepsHelp,
} from '../dishes/dto/photo.dto';
import { AvatarService } from './avatar.service';
import { UsersService } from './users.service';

const AVATAR_EXAMPLE = {
  avatarUrl: 'https://photos.labsfood.fr/users/a0eebc99…/avatar/ph_9f2a….jpg',
};

/** Every account's profile photo, and its takedown by an admin. */
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class AvatarController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly users: UsersService,
  ) {}

  @Post('me/avatar/upload-url')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Add my profile photo, step 1 of 3: get an upload link',
    description:
      'For every account: client, batch cooker (a candidate too) and admin. A batch ' +
      'cooker’s photo shows on their public page once they are approved and online.\n\n' +
      photoStepsHelp('/me/avatar/confirm'),
  })
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: PHOTO_UPLOAD_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiClerkAuthResponses()
  uploadUrl(@CurrentClerkUser() user: ClerkUser, @Body() payload: PhotoUploadDto) {
    return this.avatars.uploadUrl(user.userId, payload);
  }

  @Post('me/avatar/confirm')
  @ApiTags(TAGS.me)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add my profile photo, step 3 of 3: confirm',
    description:
      'Once the `PUT` succeeded. The API checks the file is really there, with the ' +
      'type and size announced, then makes it the profile photo; the previous one is ' +
      'deleted. It appears as `avatarUrl` on `GET /me`.',
  })
  @ApiOkResponse({ description: 'The new photo.', example: AVATAR_EXAMPLE })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`: no file arrived for this `uploadId`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`UNSUPPORTED_MEDIA_TYPE`: the file does not match the type and size announced.',
  })
  @ApiClerkAuthResponses()
  confirm(@CurrentClerkUser() user: ClerkUser, @Body() payload: PhotoConfirmDto) {
    return this.avatars.confirm(user.userId, payload);
  }

  @Delete('me/avatar')
  @ApiTags(TAGS.me)
  @ApiOperation({ summary: 'Remove my profile photo' })
  @ApiOkResponse({ description: 'No photo any more.', example: { avatarUrl: null } })
  @ApiClerkAuthResponses()
  remove(@CurrentClerkUser() user: ClerkUser) {
    return this.avatars.removeOwn(user.userId);
  }

  @Delete('admin/users/:id/avatar')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Take down someone’s profile photo',
    description:
      'Removes the photo from the account and from storage, and writes it to the audit ' +
      'journal. The person can upload another one. `{id}` is the account id ' +
      '(`users.id`).',
  })
  @ApiParam({
    name: 'id',
    description: 'The account id (`users.id`).',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiOkResponse({ description: 'No photo any more.', example: { avatarUrl: null } })
  @ApiNotFoundResponse({ description: 'No account with this id.' })
  @ApiAdminAuthResponses()
  async takeDown(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    // The admin's Postgres id: audit rows record a person, not a Clerk subject.
    const admin = await this.users.findByClerkId(user.userId);
    return this.avatars.takeDown(id, admin!.id);
  }
}
