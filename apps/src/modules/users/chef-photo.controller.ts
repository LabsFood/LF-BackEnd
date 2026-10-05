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
import { PhotoConfirmDto, PhotoUploadDto } from '../dishes/dto/photo.dto';
import { ChefPhotoService } from './chef-photo.service';
import { ChefProfileDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

const NOT_A_CHEF =
  'This account is not a batch cooker. Becoming one goes through `POST /chef-applications`.';

/** The batch cooker's profile photo, and its takedown by an admin. */
@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class ChefPhotoController {
  constructor(
    private readonly photos: ChefPhotoService,
    private readonly users: UsersService,
  ) {}

  @Post('me/chef-profile/photo/upload-url')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Add a photo to my batch cooker page, step 1 of 3: get an upload link',
    description:
      'Three calls, and the file never goes through this API:\n\n' +
      '1. This call, with the picture’s type and size. It answers with a private ' +
      '`url` valid 15 minutes and an `uploadId`.\n' +
      '2. `PUT` the file to that `url`, with the `headers` given. Its length must be ' +
      'exactly `sizeBytes`: storage refuses anything else (403).\n' +
      '3. `POST /me/chef-profile/photo/confirm` with the `uploadId`.\n\n' +
      'Open while the candidature is still reviewed: the photo shows publicly once the ' +
      'batch cooker is approved and online. JPEG, PNG or WebP, 5 MB at most. Answers ' +
      '`503 PHOTOS_UNAVAILABLE` when this server has no photo storage.',
  })
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: {
      uploadId: 'ph_9f2a1c4e7b30d85a61c2e4f7',
      method: 'PUT',
      url: 'https://<account>.r2.cloudflarestorage.com/<bucket>/chefs/…?X-Amz-Signature=…',
      headers: { 'Content-Type': 'image/jpeg' },
      expiresAt: '2026-10-03T10:15:00.000Z',
    },
  })
  @ApiUnprocessableEntityResponse({
    description: '`UNSUPPORTED_MEDIA_TYPE` or `FILE_TOO_LARGE`.',
  })
  @ApiNotFoundResponse({ description: NOT_A_CHEF })
  @ApiClerkAuthResponses()
  uploadUrl(@CurrentClerkUser() user: ClerkUser, @Body() payload: PhotoUploadDto) {
    return this.photos.uploadUrl(user.userId, payload);
  }

  @Post('me/chef-profile/photo/confirm')
  @ApiTags(TAGS.me)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a photo to my batch cooker page, step 3 of 3: confirm',
    description:
      'Once the `PUT` succeeded. The API checks the file is really there, with the ' +
      'type and size announced, then makes it the profile photo; the previous one is ' +
      'deleted.\n\nExample: `{ "uploadId": "ph_9f2a…", "contentType": "image/jpeg" }`.',
  })
  @ApiOkResponse({ type: ChefProfileDto, description: 'The page, with its photo.' })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`: no file arrived for this `uploadId`.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`UNSUPPORTED_MEDIA_TYPE`: the file does not match the type and size announced.',
  })
  @ApiNotFoundResponse({ description: NOT_A_CHEF })
  @ApiClerkAuthResponses()
  confirm(@CurrentClerkUser() user: ClerkUser, @Body() payload: PhotoConfirmDto) {
    return this.photos.confirm(user.userId, payload);
  }

  @Delete('me/chef-profile/photo')
  @ApiTags(TAGS.me)
  @ApiOperation({ summary: 'Remove my batch cooker page’s photo' })
  @ApiOkResponse({ type: ChefProfileDto, description: 'The page, without a photo.' })
  @ApiNotFoundResponse({ description: NOT_A_CHEF })
  @ApiClerkAuthResponses()
  remove(@CurrentClerkUser() user: ClerkUser) {
    return this.photos.removeOwn(user.userId);
  }

  @Delete('admin/chefs/:id/photo')
  @ApiTags(TAGS.adminChefs)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Take down a batch cooker’s profile photo',
    description:
      'Removes the photo from the page and from storage, and writes it to the audit ' +
      'journal. The batch cooker can upload another one. `{id}` is the batch cooker ' +
      'page id (`chefProfile.id`), not the account id.',
  })
  @ApiParam({
    name: 'id',
    description: 'The batch cooker page id (`chefProfile.id`).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({ type: ChefProfileDto, description: 'The page, without a photo.' })
  @ApiNotFoundResponse({ description: 'No batch cooker page with this id.' })
  @ApiAdminAuthResponses()
  async takeDown(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClerkUser() user: ClerkUser,
  ) {
    // The admin's Postgres id: audit rows record a person, not a Clerk subject.
    const admin = await this.users.findByClerkId(user.userId);
    return this.photos.takeDown(id, admin!.id);
  }
}
