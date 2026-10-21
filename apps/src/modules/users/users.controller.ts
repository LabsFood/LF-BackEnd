import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/dto/pagination.dto';
import { TAGS } from '../../common/swagger/tags';
import { UserRole } from '../../generated/prisma/client';
import { ListAdminClientsQueryDto } from './dto/admin-client.dto';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UpdateMeChefProfileDto } from './dto/chef-profile.dto';
import {
  SapProfileDto,
  UpdateMeSapProfileDto,
  UpdateSapExternalStatusDto,
} from './dto/sap-profile.dto';
import { UpdateAdminClientDto, UpdateMeProfileDto } from './dto/profile.dto';
import { UpdateChefVerificationDto } from './dto/admin-chef.dto';
import {
  AdminClientDto,
  ChefProfileDto,
  ClerkJwtClaimsDto,
  ClientProfileDto,
  CurrentUserDto,
  MeResponseDto,
  PaginatedAdminClientsDto,
  UserWithProfileDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiBearerAuth()
@Controller()
@UseGuards(ClerkAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private toUserResponse(user: {
    id: string;
    clerkUserId: string;
    email: string;
    fullName: string | null;
    role: UserRole;
  }): {
    id: string;
    clerkUserId: string;
    email: string;
    fullName: string | null;
    role: string;
  } {
    return {
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }

  @Get('thisUser')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Show what the token says (debugging)',
    description:
      'Decodes the Bearer token and echoes the Clerk ids it carries. Reads nothing from ' +
      'the database, so it is only useful to check that a token is accepted. The app ' +
      'itself should call `GET /me`.',
  })
  @ApiOkResponse({
    type: ClerkJwtClaimsDto,
    description: 'The ids found in the token.',
  })
  @ApiClerkAuthResponses()
  thisUser(@CurrentClerkUser() user: ClerkUser): ClerkJwtClaimsDto {
    return {
      user_id: user.userId,
      session_id: user.sessionId,
      email: user.email,
    };
  }

  @Get('me')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Who am I, and which space do I open?',
    description:
      'Call this right after sign-in. `role` says which space to open: `client`, `chef` ' +
      'or `admin`. For a batch cooker, `chefProfile.isVerified` says whether the space ' +
      'is fully usable (`true`) or browse-only while the candidature is reviewed ' +
      '(`false`). `hasPassword: false` means the account has no password yet (a batch ' +
      'cooker who came in through the emailed link): ask them to choose one.\n\n' +
      'The first call for a new Clerk account also creates its record here, as a client.',
  })
  @ApiOkResponse({
    type: MeResponseDto,
    description: 'The signed-in person.',
  })
  @ApiClerkAuthResponses()
  async me(@CurrentClerkUser() user: ClerkUser): Promise<MeResponseDto> {
    return this.users.currentUser(user.userId, user.email);
  }

  @Get('me/profile')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Get my profile',
    description:
      'The person plus their profile. `profileType` tells which kind `profile` is: ' +
      '`client` (tastes, address, household), `chef` (public batch cooker page), or ' +
      '`none` with `profile: null` for a client who has not filled in the profile yet.',
  })
  @ApiExtraModels(ClientProfileDto, ChefProfileDto)
  @ApiOkResponse({
    type: UserWithProfileDto,
    description: 'The person and their profile, if any.',
  })
  @ApiClerkAuthResponses()
  meProfile(@CurrentClerkUser() user: ClerkUser): Promise<UserWithProfileDto> {
    return this.users.getProfileByClerkUserId(user.userId);
  }

  @Patch('me/profile')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Fill in or update my client profile',
    description:
      'Saves the client profile: tastes, allergies, kitchen notes, address, household. ' +
      'The first call creates it; later calls change only the fields sent. ' +
      '`firstName`, `lastName` and `phone` go to the account itself (and to Clerk for ' +
      'the names). Never changes the role.\n\n' +
      'Example: `{ "allergies": ["arachides"], "householdAdults": 2 }` updates those two ' +
      'fields and leaves the rest as it was.',
  })
  @ApiOkResponse({
    type: ClientProfileDto,
    description: 'The saved client profile.',
  })
  @ApiConflictResponse({
    description:
      'This account is a batch cooker. One account holds one kind of profile for now.',
  })
  @ApiClerkAuthResponses()
  patchMeProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateMeProfileDto,
  ) {
    return this.users.updateProfileByClerkUserId(user.userId, payload);
  }

  @Patch('me/chef-profile')
  @ApiTags(TAGS.me)
  @ApiOperation({
    summary: 'Update my batch cooker page',
    description:
      'Changes what clients see on the batch cooker page: `displayName`, `bio`, `city`, ' +
      '`serviceRadiusKm`, `languages`, plus `firstName`, `lastName` and `phone` on the ' +
      'account. Send ' +
      'only the fields to change.\n\n' +
      'Only for an approved batch cooker: while the candidature is reviewed the account ' +
      'is browse-only. The visibility flags, the SAP route and the zones are set at ' +
      'approval and cannot be sent here.',
  })
  @ApiOkResponse({
    type: ChefProfileDto,
    description: 'The updated batch cooker page.',
  })
  @ApiForbiddenResponse({
    description: '`CHEF_NOT_VERIFIED`: the candidature is not approved yet.',
  })
  @ApiNotFoundResponse({
    description:
      'This account is not a batch cooker. Becoming one goes through `POST /chef-applications`.',
  })
  @ApiClerkAuthResponses()
  patchMeChefProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateMeChefProfileDto,
  ) {
    return this.users.updateOwnChefProfile(user.userId, payload);
  }

  @Get('me/chef-profile/sap')
  @ApiOperation({
    summary: 'Get my "service à la personne" declaration',
    description:
      "Returns the authenticated chef's `sap_profiles` row, or `null` when they have " +
      'not declared yet. Requires an existing chef profile.',
  })
  @ApiOkResponse({
    type: SapProfileDto,
    description: 'The chef SAP declaration, or `null` when not declared yet.',
  })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  getMeSapProfile(@CurrentClerkUser() user: ClerkUser) {
    return this.users.getSapProfileByClerkUserId(user.userId);
  }

  @Patch('me/chef-profile/sap')
  @ApiOperation({
    summary: 'Declare my "service à la personne" route',
    description:
      'Upserts `sap_profiles` for the authenticated chef. `type_a_nova` requires ' +
      '`novaCode`; `type_b_cooperative` requires `cooperativeName` and ' +
      '`cooperativeMembershipProof`. Fields of the other type are cleared on switch. ' +
      'The URSSAF and CRCESU status fields are not accepted here — they stay ' +
      '`not_started` until those integrations exist, mirroring `isActive`/`isVerified` ' +
      'on the chef profile.',
  })
  @ApiOkResponse({ type: SapProfileDto, description: 'Saved SAP declaration.' })
  @ApiConflictResponse({
    description: 'No chef profile yet — complete `PATCH /me/chef-profile` first.',
  })
  @ApiClerkAuthResponses()
  patchMeSapProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateMeSapProfileDto,
  ) {
    return this.users.updateSapProfileByClerkUserId(user.userId, payload);
  }

  @Post('admin/users')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Create an account for someone',
    description:
      'Creates the account with the chosen role, for example a new admin. Without a ' +
      '`password` the account has none, and the person signs in with whatever else Clerk ' +
      'allows, such as an email code. The email is treated as verified.\n\n' +
      'Do not use this to make a batch cooker: they apply through `POST /chef-applications`, ' +
      'which checks their documents.',
  })
  @ApiCreatedResponse({
    type: CurrentUserDto,
    description: 'The new account.',
  })
  @ApiConflictResponse({ description: 'This email already has an account.' })
  @ApiAdminAuthResponses()
  @ApiServiceUnavailableResponse({
    description: 'The server has no Clerk key, so it cannot create accounts.',
  })
  createAdminUser(@Body() payload: CreateAdminUserDto) {
    return this.users.provisionAdminUser({
      email: payload.email,
      password: payload.password,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role ? this.users.toUserRole(payload.role) : undefined,
    });
  }

  @Patch('admin/users/:id/role')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Change someone's role",
    description:
      'Sets the role to `client`, `chef` or `admin`. The change applies on the next ' +
      'request: roles are read from this API, not from the token. `{id}` is the id ' +
      'returned by `GET /me` (not the Clerk `user_…` id).\n\n' +
      'Setting `chef` does not create a batch cooker page or verify anyone; that is ' +
      'what a candidature does.',
  })
  @ApiParam({
    name: 'id',
    description: 'The account id (`users.id`).',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiOkResponse({
    type: CurrentUserDto,
    description: 'The account with its new role.',
  })
  @ApiNotFoundResponse({ description: 'No account with this id.' })
  @ApiAdminAuthResponses()
  updateUserRole(@Param('id') id: string, @Body() payload: UpdateUserRoleDto) {
    return this.users.updateRole(id, this.users.toUserRole(payload.role));
  }

  @Patch('admin/chefs/:id/verification')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Put a batch cooker online or offline',
    description:
      '`isActive` decides whether clients can book this batch cooker; `isVerified` ' +
      'whether the platform vouches for them.\n\n' +
      '- Taking someone offline (`{ "isActive": false }`) always works.\n' +
      '- Putting someone online needs them verified, else `409 CHEF_NOT_VERIFIED`.\n' +
      '- Verifying someone who applied is done by approving the candidature, where the ' +
      'documents are checked. Here it answers `409 APPLICATION_NOT_APPROVED` until then.\n' +
      '- Withdrawing verification from someone online: send `isActive: false` too.\n\n' +
      '`{id}` is the batch cooker page id (`chefProfile.id`), not the account id.',
  })
  @ApiParam({
    name: 'id',
    description: 'The batch cooker page id (`chefProfile.id` in `GET /me`).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({
    type: ChefProfileDto,
    description: 'The batch cooker page with its new flags.',
  })
  @ApiConflictResponse({
    description:
      '`APPLICATION_NOT_APPROVED`: approve the candidature instead. ' +
      '`CHEF_NOT_VERIFIED`: an unverified batch cooker cannot go online.',
  })
  @ApiNotFoundResponse({ description: 'No batch cooker page with this id.' })
  @ApiAdminAuthResponses()
  updateChefVerification(
    @Param('id') id: string,
    @Body() payload: UpdateChefVerificationDto,
  ) {
    return this.users.setChefVerification(id, payload);
  }

  @Patch('admin/chefs/:id/sap-external-status')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: set a chef external SAP statuses',
    description:
      'Writes `crcesu_affiliation_status` and `urssaf_tiers_prestation_status` on the ' +
      "chef's `sap_profiles` row. Same split as `is_verified` / `is_active`: the chef " +
      'declares, an admin habilitates — no self-habilitation. There is no CRCESU API to ' +
      "read the affiliation from, so an admin transcribing the CRCESU's answer is the " +
      'only source this field can have. `:id` is the chef profile uuid ' +
      '(`chef_profiles.id`); the chef must already have declared a SAP route.',
  })
  @ApiParam({
    name: 'id',
    description: 'Chef profile uuid (`chef_profiles.id`).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({ type: SapProfileDto, description: 'SAP profile after the update.' })
  @ApiAdminAuthResponses()
  updateSapExternalStatus(
    @Param('id') id: string,
    @Body() payload: UpdateSapExternalStatusDto,
  ) {
    return this.users.setSapExternalStatus(id, payload);
  }

  @Get('admin/clients')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List clients',
    description:
      'Newest first, one page at a time: `?page=2&limit=50`. ' +
      `Pages hold ${DEFAULT_PAGE_SIZE} clients unless \`limit\` says otherwise, ` +
      `${MAX_PAGE_SIZE} at most. \`?status=vip\` keeps only one CRM status. ` +
      '`meta` says how many there are in total and whether another page follows.',
  })
  @ApiOkResponse({
    type: PaginatedAdminClientsDto,
    description: 'One page of clients, each with their account.',
  })
  @ApiAdminAuthResponses()
  listClients(@Query() query: ListAdminClientsQueryDto) {
    return this.users.listClients(query);
  }

  @Get('admin/clients/:id')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get one client',
    description:
      'The client profile with its account. `{id}` is the client profile id, as listed ' +
      'by `GET /admin/clients`, not the account id. An unknown id answers `200` with an ' +
      'empty body.',
  })
  @ApiParam({
    name: 'id',
    description: 'The client profile id.',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @ApiOkResponse({
    type: AdminClientDto,
    description: 'The client, or an empty body if the id is unknown.',
  })
  @ApiAdminAuthResponses()
  getClient(@Param('id') id: string) {
    return this.users.getClientById(id);
  }

  @Patch('admin/clients/:id')
  @ApiTags(TAGS.adminUsers)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Update a client's profile",
    description:
      'Changes tastes, kitchen notes or the CRM `status` (for example `{ "status": "vip" }`). ' +
      'Send only the fields to change. `{id}` is the client profile id.',
  })
  @ApiParam({
    name: 'id',
    description: 'The client profile id.',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @ApiOkResponse({
    type: AdminClientDto,
    description: 'The updated client.',
  })
  @ApiAdminAuthResponses()
  updateClient(@Param('id') id: string, @Body() payload: UpdateAdminClientDto) {
    return this.users.updateClientById(id, payload);
  }
}
