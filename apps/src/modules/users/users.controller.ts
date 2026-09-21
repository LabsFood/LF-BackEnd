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
import { UserRole } from '../../generated/prisma/client';
import { ListAdminClientsQueryDto } from './dto/admin-client.dto';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UpdateMeChefProfileDto } from './dto/chef-profile.dto';
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

@ApiTags('users')
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
  @ApiOperation({
    summary: 'Read Clerk JWT claims (no database)',
    description:
      'Returns identifiers decoded from the Bearer token only. ' +
      'Use this to debug authentication. For the persisted application user (role, email, id), call `GET /me`.',
  })
  @ApiOkResponse({
    type: ClerkJwtClaimsDto,
    description: 'Clerk session claims attached by `ClerkAuthGuard`.',
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
  @ApiOperation({
    summary: 'Get or create the current application user',
    description:
      'Ensures a Postgres `users` row exists for the authenticated Clerk subject, ' +
      'creating one with `role: client` on first access. Returns id, email, fullName, ' +
      'phone, role, `hasPassword`, and `chefProfile` when there is one. ' +
      'Clients and batch cookers share one sign-in page, so this is what tells the ' +
      'frontend which space to open — it answers for an inactive chef too, since an ' +
      'unpublished batch cooker still needs to reach their dossier.',
  })
  @ApiOkResponse({
    type: MeResponseDto,
    description: 'Persisted user mapped from the Clerk JWT `sub` claim.',
  })
  @ApiClerkAuthResponses()
  async me(@CurrentClerkUser() user: ClerkUser): Promise<MeResponseDto> {
    return this.users.currentUser(user.userId, user.email);
  }

  @Get('me/profile')
  @ApiOperation({
    summary: 'Get current user and their profile',
    description:
      'Returns the persisted user plus whichever profile matches `users.role`: ' +
      '`client_profiles` for clients, `chef_profiles` for chefs. Read `profileType` to ' +
      'know which shape `profile` holds; it is `none` with a `null` profile until the ' +
      'user completes onboarding form 2.',
  })
  @ApiExtraModels(ClientProfileDto, ChefProfileDto)
  @ApiOkResponse({
    type: UserWithProfileDto,
    description: 'User record and the profile matching their role, if any.',
  })
  @ApiClerkAuthResponses()
  meProfile(@CurrentClerkUser() user: ClerkUser): Promise<UserWithProfileDto> {
    return this.users.getProfileByClerkUserId(user.userId);
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: 'Create or update client profile (onboarding form 2)',
    description:
      'Upserts `client_profiles` for the authenticated user and writes the shared ' +
      'identity fields (`firstName`, `lastName`, `phone`) to `users`, mirroring names ' +
      'into Clerk. Send only the fields you want to change. ' +
      '**Never changes `users.role`** — new accounts are already `client` from ' +
      'registration, so an admin or chef editing their profile keeps their role.',
  })
  @ApiOkResponse({
    type: ClientProfileDto,
    description: 'Saved client profile after upsert.',
  })
  @ApiConflictResponse({
    description:
      'User already has a chef profile. Switching profile type is not supported yet.',
  })
  @ApiClerkAuthResponses()
  patchMeProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateMeProfileDto,
  ) {
    return this.users.updateProfileByClerkUserId(user.userId, payload);
  }

  @Patch('me/chef-profile')
  @ApiOperation({
    summary: 'Edit your own batch cooker profile',
    description:
      'Updates the public fields of the caller’s existing chef profile — `displayName`, ' +
      '`bio`, `city`, `serviceRadiusKm` — and the shared identity fields on `users`. ' +
      'Every field is optional. **Never creates a profile and never changes ' +
      '`users.role`**: a batch cooker account is created only when an admin approves a ' +
      'candidature. `isActive`, `isVerified`, payout and calendar ids, the SAP route and ' +
      'intervention zones are not editable here, and a body carrying them is refused.',
  })
  @ApiOkResponse({
    type: ChefProfileDto,
    description: 'The chef profile after the update.',
  })
  @ApiNotFoundResponse({
    description:
      'The caller has no batch cooker profile. A client cannot use this route to become one.',
  })
  @ApiClerkAuthResponses()
  patchMeChefProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateMeChefProfileDto,
  ) {
    return this.users.updateOwnChefProfile(user.userId, payload);
  }

  @Post('admin/users')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: provision a new Clerk user and Postgres row',
    description:
      'Creates a user in Clerk via Backend API and persists a matching `users` row with the requested role. ' +
      'Requires `users.role = admin` and a real `CLERK_SECRET_KEY` (not `sk_test_placeholder`). ' +
      'Email is auto-verified by Clerk BAPI. Omit `password` for a passwordless account.',
  })
  @ApiCreatedResponse({
    type: CurrentUserDto,
    description: 'Newly created Postgres user linked to the Clerk account.',
  })
  @ApiAdminAuthResponses()
  @ApiServiceUnavailableResponse({
    description:
      'Clerk Backend API is not configured (`sk_test_placeholder` or missing secret key).',
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
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: change a user application role',
    description:
      'Updates `users.role` in Postgres (source of truth for RBAC). ' +
      '`:id` is the Postgres uuid from `GET /me` or `POST /admin/users`, not the Clerk user id. ' +
      'Optionally mirrors the role into Clerk `publicMetadata.role` when Clerk is configured.',
  })
  @ApiParam({
    name: 'id',
    description: 'Postgres user uuid (`users.id`).',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @ApiOkResponse({
    type: CurrentUserDto,
    description: 'User record after role update.',
  })
  @ApiAdminAuthResponses()
  updateUserRole(@Param('id') id: string, @Body() payload: UpdateUserRoleDto) {
    return this.users.updateRole(id, this.users.toUserRole(payload.role));
  }

  @Patch('admin/chefs/:id/verification')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: vet a chef profile',
    description:
      'Sets `is_verified` and `is_active` on a chef profile. This is the only path that ' +
      'may change these flags — self-registered chefs always start with both `false`, ' +
      'so this endpoint is what makes a chef bookable. `:id` is the chef profile uuid ' +
      '(`chef_profiles.id`), not the user uuid.',
  })
  @ApiParam({
    name: 'id',
    description: 'Chef profile uuid (`chef_profiles.id`).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @ApiOkResponse({
    type: ChefProfileDto,
    description: 'Chef profile after the verification update.',
  })
  @ApiAdminAuthResponses()
  updateChefVerification(
    @Param('id') id: string,
    @Body() payload: UpdateChefVerificationDto,
  ) {
    return this.users.setChefVerification(id, payload);
  }

  @Get('admin/clients')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: list client profiles (paginated)',
    description:
      'Returns one page of `client_profiles` rows with nested `user`, newest first, ' +
      'under `data`, plus a `meta` page descriptor (`total`, `totalPages`, ' +
      '`hasNextPage`, `hasPreviousPage`). Defaults to `page=1` and ' +
      `\`limit=${DEFAULT_PAGE_SIZE}\`; \`limit\` is capped at ${MAX_PAGE_SIZE}. ` +
      'Filter by CRM `status` when the query parameter is provided.',
  })
  @ApiOkResponse({
    type: PaginatedAdminClientsDto,
    description: 'One page of client profiles with linked user records.',
  })
  @ApiAdminAuthResponses()
  listClients(@Query() query: ListAdminClientsQueryDto) {
    return this.users.listClients(query);
  }

  @Get('admin/clients/:id')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: get one client profile by profile id',
    description:
      'Returns a single `client_profiles` row with nested `user`. ' +
      '`:id` is the client profile uuid, not the user uuid.',
  })
  @ApiParam({
    name: 'id',
    description: 'Client profile uuid (`client_profiles.id`).',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @ApiOkResponse({
    type: AdminClientDto,
    description: 'Client profile with linked user, or `null` if not found.',
  })
  @ApiAdminAuthResponses()
  getClient(@Param('id') id: string) {
    return this.users.getClientById(id);
  }

  @Patch('admin/clients/:id')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: update a client profile',
    description:
      'Patches taste preferences, kitchen notes, and CRM `status` on an existing client profile. ' +
      '`:id` is the client profile uuid (`client_profiles.id`).',
  })
  @ApiParam({
    name: 'id',
    description: 'Client profile uuid (`client_profiles.id`).',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @ApiOkResponse({
    type: AdminClientDto,
    description: 'Updated client profile with nested user.',
  })
  @ApiAdminAuthResponses()
  updateClient(@Param('id') id: string, @Body() payload: UpdateAdminClientDto) {
    return this.users.updateClientById(id, payload);
  }
}
