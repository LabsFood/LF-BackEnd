import { Global, Module } from '@nestjs/common';

import { UsersModule } from '../modules/users/users.module';
import { AdminGuard } from './admin.guard';
import { ClerkAuthGuard } from './clerk-auth.guard';

@Global()
@Module({
  imports: [UsersModule],
  providers: [ClerkAuthGuard, AdminGuard],
  exports: [ClerkAuthGuard, AdminGuard],
})
export class AuthModule {}
