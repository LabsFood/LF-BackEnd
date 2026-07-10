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
  ApiTags,
} from '@nestjs/swagger';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { CreateAdminUserDto, UpdateUserRoleDto } from './dto/admin-user.dto';
import { UpdateAdminClientDto, UpdateClientProfileDto } from './dto/profile.dto';
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
    phone: string | null;
    role: string;
  }> {
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
  @ApiOkResponse({
    description: 'Returns authenticated user + client profile if present.',
  })
  meProfile(@CurrentClerkUser() user: ClerkUser) {
    return this.users.getProfileByClerkUserId(user.userId);
  }

  @Patch('me/profile')
  @ApiOkResponse({ description: 'Creates or updates authenticated client profile.' })
  patchMeProfile(
    @CurrentClerkUser() user: ClerkUser,
    @Body() payload: UpdateClientProfileDto,
  ) {
    return this.users.updateProfileByClerkUserId(user.userId, payload);
  }

  @Post('admin/users')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({
    description: 'Provision a Clerk user and persist role in Postgres.',
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
  @ApiOkResponse({
    description: 'Update persisted user role (Postgres source of truth).',
  })
  updateUserRole(@Param('id') id: string, @Body() payload: UpdateUserRoleDto) {
    return this.users.updateRole(id, this.users.toUserRole(payload.role));
  }

  @Get('admin/clients')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  listClients(@Query('status') status?: string) {
    return this.users.listClients(status);
  }

  @Get('admin/clients/:id')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  getClient(@Param('id') id: string) {
    return this.users.getClientById(id);
  }

  @Patch('admin/clients/:id')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  updateClient(@Param('id') id: string, @Body() payload: UpdateAdminClientDto) {
    return this.users.updateClientById(id, payload);
  }
}
