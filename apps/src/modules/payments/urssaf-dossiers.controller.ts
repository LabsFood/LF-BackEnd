import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
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
import { UrssafDossierDto } from './dto/urssaf-dossier.dto';
import { UrssafDossiersService } from './urssaf-dossiers.service';

const LINK_ID = '9a2ebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

const DOSSIER_EXAMPLE = {
  civility: 'F',
  birthName: 'Marchand',
  usageName: null,
  firstNames: 'Sophie Anne',
  birthDate: '1981-04-12',
  birthCountryCode: '99100',
  birthDepartmentCode: '075',
  birthCommuneCode: '75056',
  birthCommuneName: 'Paris',
  mobilePhone: '0612345678',
  email: 'sophie@exemple.fr',
  address: {
    line1: '12 rue des Lilas',
    line2: null,
    postalCode: '75011',
    city: 'Paris',
    countryCode: '99100',
  },
  bic: 'AGRIFRPP',
  accountHolder: 'Sophie Marchand',
};

const MINE_EXAMPLE = {
  filled: true,
  filledAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  ibanLast4: '0189',
  dossier: DOSSIER_EXAMPLE,
};

const requestId = (req: { id?: unknown }) =>
  typeof req.id === 'string' ? req.id : undefined;

/** The client's URSSAF dossier: what the immediate advance needs, asked once. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('me/urssaf-dossier')
export class UrssafDossiersController {
  constructor(private readonly dossiers: UrssafDossiersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'My URSSAF dossier',
    description:
      'The answers given, the IBAN reduced to `ibanLast4`. `filled: false` and ' +
      '`dossier: null` until it is filled.',
  })
  @ApiOkResponse({ description: 'The dossier.', example: MINE_EXAMPLE })
  @ApiServiceUnavailableResponse({
    description: '`KYC_STORAGE_UNAVAILABLE`: the dossier cannot be read right now.',
  })
  @ApiClerkAuthResponses()
  mine(@CurrentClerkUser() user: ClerkUser) {
    return this.dossiers.mine(user.userId);
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Fill or replace my URSSAF dossier',
    description:
      'The whole dossier each time, IBAN included. Sealed before it is stored; the ' +
      'team enters it on the intermediary’s space to open the immediate advance.',
  })
  @ApiOkResponse({
    description: 'The dossier, as `GET` shows it.',
    example: MINE_EXAMPLE,
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`URSSAF_DOSSIER_INVALID`: `errors[]` names each field and rule (`INVALID_IBAN`, ' +
      '`INVALID_MOBILE`, `NOT_FOR_BIRTH_ABROAD`…).',
  })
  @ApiServiceUnavailableResponse({
    description: '`KYC_STORAGE_UNAVAILABLE`: the dossier cannot be stored right now.',
  })
  @ApiClerkAuthResponses()
  save(@CurrentClerkUser() user: ClerkUser, @Body() payload: UrssafDossierDto) {
    return this.dossiers.save(user.userId, payload);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my URSSAF dossier',
    description: 'The dossier is erased. The immediate advance waits for a new one.',
  })
  @ApiNoContentResponse({ description: 'Deleted, or there was none.' })
  @ApiClerkAuthResponses()
  async remove(@CurrentClerkUser() user: ClerkUser): Promise<void> {
    await this.dossiers.remove(user.userId);
  }
}

/** The team reads a client's dossier to enter it on the intermediary's space. */
@ApiTags(TAGS.payments)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/urssaf-links')
export class AdminUrssafDossiersController {
  constructor(private readonly dossiers: UrssafDossiersService) {}

  @Get(':id/dossier')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Reveal the client’s URSSAF dossier for an enrolment',
    description:
      'Everything, IBAN included, to copy into the intermediary’s space, with ' +
      'the batch cooker’s NOVA code. Every call is audited (`urssaf.dossier_revealed`).',
  })
  @ApiParam({ name: 'id', description: 'The enrolment id.', example: LINK_ID })
  @ApiOkResponse({
    description: 'The dossier.',
    example: {
      linkId: LINK_ID,
      clientId: '3b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
      chefProfileId: '0e6f7a52-3d0b-4c1e-9a55-2b7c9d1e4f60',
      chefNovaCode: 'SAP123456789',
      sapDeclarationNumber: 'SAP100715036',
      filledAt: '2026-11-16T10:00:00.000Z',
      updatedAt: '2026-11-16T10:00:00.000Z',
      dossier: { ...DOSSIER_EXAMPLE, iban: 'FR7630006000011234567890189' },
    },
  })
  @ApiNotFoundResponse({
    description: 'No enrolment with this id, or `URSSAF_DOSSIER_MISSING`.',
  })
  @ApiServiceUnavailableResponse({
    description: '`KYC_STORAGE_UNAVAILABLE`: the dossier cannot be read right now.',
  })
  @ApiAdminAuthResponses()
  reveal(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { id?: unknown },
  ) {
    return this.dossiers.reveal(user.userId, id, requestId(req));
  }
}
