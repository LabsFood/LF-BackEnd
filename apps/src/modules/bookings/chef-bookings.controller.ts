import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import {
  PHOTO_UPLOAD_EXAMPLE,
  PhotoUploadDto,
  photoStepsHelp,
} from '../dishes/dto/photo.dto';
import { BookingPhotosService } from './booking-photos.service';
import { BookingReschedulesService } from './booking-reschedules.service';
import { BookingsService } from './bookings.service';
import {
  BookingPhotoConfirmDto,
  ChefBookingsQueryDto,
  ChefUpdateBookingDto,
  NewBookingForClientDto,
  RescheduleAnswerDto,
  RescheduleDto,
} from './dto/bookings.dto';
import {
  ApiBookingId,
  BOOKING_DETAIL_EXAMPLE,
  BOOKING_ITEM_EXAMPLE,
  RESCHEDULE_DECIDE_CONFLICTS,
  RESCHEDULE_EXAMPLE,
  RESCHEDULE_HELP,
  RESCHEDULE_PROPOSE_CONFLICTS,
  STATUS_HELP,
} from './swagger-examples';

const PHOTOS_EXAMPLE = [
  {
    id: 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
    url: 'https://photos.labsfood.fr/bookings/7b1ebc99…/ph_9f2a….jpg',
    caption: 'Les bocaux étiquetés',
    takenAt: '2026-10-21T09:41:00.000Z',
  },
];

const NO_CHEF =
  '`NOT_A_CHEF`: no batch cooker page for this account; or no such booking among mine.';

/**
 * "Mes prestations": the signed-in batch cooker's bookings, filterable by client.
 * Another batch cooker's booking is a 404.
 */
@ApiTags(TAGS.chefBookings)
@ApiBearerAuth()
// Every route here is work: a candidate awaiting approval gets this 403.
@ApiForbiddenResponse({
  description: '`CHEF_NOT_VERIFIED`: the candidature is not approved yet.',
})
@Controller('chef/bookings')
@UseGuards(ClerkAuthGuard)
export class ChefBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly photos: BookingPhotosService,
    private readonly reschedules: BookingReschedulesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List my prestations',
    description:
      'Earliest first, as an agenda reads. `?clientId=` keeps one client’s; `status`, ' +
      '`from` and `to` (on the start) narrow it down.\n\n' +
      '`netCents` is what I earn: the paid part keeps the commission taken at payment, ' +
      'the rest is priced as its payment would be (a custom request keeps its offer’s ' +
      'deal). `commissionEstimated` stays true until it is fully paid. `collectedNetCents` ' +
      'is only what has come in, after its commission: use it for “encaissé”, not `netCents`. ' +
      'The client shows ' +
      'as first name and initial.',
  })
  @ApiOkResponse({
    description: 'One page, with `meta` for the paging.',
    example: { data: [BOOKING_ITEM_EXAMPLE], meta: { page: 1, limit: 20, total: 1 } },
  })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiForbiddenResponse({ description: '`CHEF_NOT_VERIFIED`.' })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser, @Query() query: ChefBookingsQueryDto) {
    return this.bookings.listFor('chef', user.userId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Open one of my prestations',
    description:
      'With its dishes, its photos, and what the client cannot eat: `allergies` and ' +
      '`diets` from their profile, plus their custom request’s, read at this moment.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The prestation.', example: BOOKING_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiClerkAuthResponses()
  detail(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.detailFor('chef', user.userId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Book for one of my clients',
    description:
      'For a client I already know: a booking or a conversation between us. Created ' +
      '`pending`, on one of my offers, at a time I am free; the client accepts it by ' +
      'paying it, within 72 h.',
  })
  @ApiCreatedResponse({ description: 'The prestation.', example: BOOKING_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: '`OFFER_NOT_FOUND` or `CLIENT_NOT_FOUND`.' })
  @ApiConflictResponse({
    description: '`SLOT_UNAVAILABLE`, `SAME_PERSON` or `CHEF_UNAVAILABLE`.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'A past start, `FORMULE_UNAVAILABLE` or `MEAL_UNAVAILABLE`.',
  })
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: NewBookingForClientDto) {
    return this.bookings.create('chef', user.userId, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Move one of my prestations along',
    description:
      'Only `status`: the details are the client’s. `cooking` records my arrival ' +
      '(`arrivedAt`), from 2 h before the start.\n\n' +
      STATUS_HELP,
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The prestation.', example: BOOKING_DETAIL_EXAMPLE })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiConflictResponse({
    description:
      '`INVALID_TRANSITION`, `TOO_EARLY`, `BOOKING_PAID`, `BOOKING_STARTED` or ' +
      '`CHANGED_MEANWHILE`.',
  })
  @ApiClerkAuthResponses()
  update(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChefUpdateBookingDto,
  ) {
    return this.bookings.update('chef', user.userId, id, body);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Propose a new time', description: RESCHEDULE_HELP })
  @ApiBookingId()
  @ApiCreatedResponse({ description: 'The proposal.', example: RESCHEDULE_EXAMPLE })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiConflictResponse({ description: RESCHEDULE_PROPOSE_CONFLICTS })
  @ApiClerkAuthResponses()
  propose(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleDto,
  ) {
    return this.reschedules.propose('chef', user.userId, id, body.startsAt);
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Answer a new time',
    description:
      '`accepted` moves the prestation; `declined` keeps it; `withdrawn` takes back ' +
      'my own proposal.\n\n' +
      RESCHEDULE_HELP,
  })
  @ApiBookingId()
  @ApiOkResponse({
    description: 'The proposal, answered.',
    example: { ...RESCHEDULE_EXAMPLE, status: 'accepted' },
  })
  @ApiNotFoundResponse({
    description: '`RESCHEDULE_NOT_FOUND`: no new time waits. Or ' + NO_CHEF,
  })
  @ApiConflictResponse({ description: RESCHEDULE_DECIDE_CONFLICTS })
  @ApiClerkAuthResponses()
  decide(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleAnswerDto,
  ) {
    return this.reschedules.decide('chef', user.userId, id, body.decision);
  }

  @Post(':id/photos/upload-url')
  @ApiOperation({
    summary: 'Add a photo to my prestation, step 1 of 3: get an upload link',
    description:
      'Once the prestation has started (`shopping` on), 20 photos at most. The client ' +
      'sees them on their booking.\n\n' +
      photoStepsHelp('/chef/bookings/{id}/photos'),
  })
  @ApiBookingId()
  @ApiCreatedResponse({
    description: 'Where to send the file.',
    example: PHOTO_UPLOAD_EXAMPLE,
  })
  @ApiConflictResponse({ description: '`NOT_STARTED` or `TOO_MANY_PHOTOS`.' })
  @ApiNotFoundResponse({ description: NO_CHEF })
  @ApiClerkAuthResponses()
  photoUploadUrl(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PhotoUploadDto,
  ) {
    return this.photos.uploadUrl(user.userId, id, body);
  }

  @Post(':id/photos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a photo to my prestation, step 3 of 3: confirm',
    description:
      'Once the `PUT` succeeded: the API checks the file is really there, with the ' +
      'type and size announced. Example: `{ "uploadId": "ph_9f2a…", "contentType": ' +
      '"image/jpeg", "caption": "Les bocaux étiquetés" }`.',
  })
  @ApiBookingId()
  @ApiOkResponse({ description: 'The prestation’s photos.', example: PHOTOS_EXAMPLE })
  @ApiConflictResponse({
    description: '`UPLOAD_NOT_CONFIRMED`, `NOT_STARTED` or `TOO_MANY_PHOTOS`.',
  })
  @ApiUnprocessableEntityResponse({ description: '`UNSUPPORTED_MEDIA_TYPE`.' })
  @ApiClerkAuthResponses()
  addPhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BookingPhotoConfirmDto,
  ) {
    return this.photos.add(user.userId, id, body);
  }

  @Delete(':id/photos/:photoId')
  @ApiOperation({ summary: 'Remove a photo from my prestation' })
  @ApiBookingId()
  @ApiParam({ name: 'photoId', description: 'The photo id.' })
  @ApiOkResponse({ description: 'The photos left.', example: [] })
  @ApiNotFoundResponse({ description: '`PHOTO_NOT_FOUND`.' })
  @ApiClerkAuthResponses()
  removePhoto(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.photos.remove(user.userId, id, photoId);
  }
}
