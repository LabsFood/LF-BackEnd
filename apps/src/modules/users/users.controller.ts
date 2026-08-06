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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '../../generated/prisma/client';

import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UpdateAdminClientDto, UpdateClientProfileDto } from './dto/profile.dto';
import {
  AdminClientDto,
  ClerkJwtClaimsDto,
  ClientProfileDto,
  CurrentUserDto,
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
      'creating one with `role: client` on first access. Returns id, email, fullName, phone, and role. ' +
      'Frontends should call this after sign-in to obtain the LF user id and RBAC role.',
  })
  @ApiOkResponse({
    type: CurrentUserDto,
    description: 'Persisted user mapped from the Clerk JWT `sub` claim.',
  })
  @ApiClerkAuthResponses()
  async me(@CurrentClerkUser() user: ClerkUser): Promise<CurrentUserDto> {
    const persisted = await this.users.ensurePersistedFromClerk(user.userId, {
      email: user.email,
    });
    return {
      id: persisted.id,
      clerkUserId: persisted.clerkUserId,
      email: persisted.email,
      fullName: persisted.fullName,
      phone: persisted.phone,
      role: persisted.role,
    };
  }

  @Get('me/profile')
  @ApiOperation({
    summary: 'Get current user and client taste profile',
    description:
      'Returns the persisted user plus the linked `client_profiles` row when it exists. ' +
      '`profile` is `null` until the client saves preferences via `PATCH /me/profile`.',
  })
  @ApiOkResponse({
    type: UserWithProfileDto,
    description: 'User record and optional client profile.',
  })
  @ApiClerkAuthResponses()
  meProfile(@CurrentClerkUser() user: ClerkUser): Promise<UserWithProfileDto> {
    return this.users.getProfileByClerkUserId(user.userId);
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: 'Create or update client taste profile',
    description:
      'Upserts `client_profiles` for the authenticated user. ' +
      'Send only the fields you want to change (partial update). ' +
      'Creates the profile on first call with defaults for omitted arrays.',
  })
  @ApiOkResponse({
    type: ClientProfileDto,
    description: 'Saved client profile after upsert.',
  })
  @ApiClerkAuthResponses()
  patchMeProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateClientProfileDto,
  ) {
    return this.users.updateProfileByClerkUserId(user.userId, payload);
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

  @Get('admin/clients')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Admin: list client profiles',
    description:
      'Returns all `client_profiles` rows with nested `user`, newest first. ' +
      'Filter by CRM `status` when the query parameter is provided.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['vip', 'active', 'prospect', 'inactive'],
    description: 'Optional CRM status filter.',
  })
  @ApiOkResponse({
    type: AdminClientDto,
    isArray: true,
    description: 'Client profiles with linked user records.',
  })
  @ApiAdminAuthResponses()
  listClients(@Query('status') status?: string) {
    return this.users.listClients(status);
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
