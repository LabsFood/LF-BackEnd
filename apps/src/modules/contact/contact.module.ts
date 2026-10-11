import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AdminContactController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';

/** The public contact forms and the admin inbox they feed. */
@Module({
  imports: [UsersModule],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
