import { Body, Controller, Delete, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { ApiClerkAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { UserWithProfileDto } from '../users/dto/user-response.dto';
import { AllergiesService } from './allergies.service';
import { DeclareAllergiesDto } from './dto/allergies.dto';

@ApiTags(TAGS.me)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/profile')
export class AllergiesController {
  constructor(private readonly allergies: AllergiesService) {}

  @Put('allergies')
  @ApiOperation({
    summary: 'Declare my allergies, or none',
    description:
      'Until the client answers once, no menu can be validated (`ALLERGIES_NOT_DECLARED`). ' +
      'A list needs `consent: true` with the `healthConsent.version` of `GET /me/profile`; ' +
      '"none" needs neither. Replaces the previous answer. An allergy added after a menu ' +
      'was validated flags the dishes in conflict (`allergyConflicts` on the booking) and ' +
      'tells the client and the batch cooker in the app.',
  })
  @ApiOkResponse({
    type: UserWithProfileDto,
    description: 'My profile, as `GET /me/profile`.',
  })
  @ApiConflictResponse({ description: 'This account is a batch cooker.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`HEALTH_CONSENT_REQUIRED` (with the current `version`), or `VALIDATION_FAILED` on ' +
      '`allergies`: "none" next to a list, or an empty list.',
  })
  @ApiClerkAuthResponses()
  declare(@CurrentClerkUser() user: ClerkUser, @Body() body: DeclareAllergiesDto) {
    return this.allergies.declare(user.userId, body);
  }

  @Delete('health-consent')
  @ApiOperation({
    summary: 'Withdraw my consent',
    description:
      'Erases the allergies and the consent. The question comes back: no menu can be ' +
      'validated until I answer again.',
  })
  @ApiOkResponse({
    type: UserWithProfileDto,
    description: 'My profile, as `GET /me/profile`.',
  })
  @ApiClerkAuthResponses()
  withdraw(@CurrentClerkUser() user: ClerkUser) {
    return this.allergies.withdraw(user.userId);
  }
}
