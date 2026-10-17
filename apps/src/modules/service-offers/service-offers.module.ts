import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ServiceOffersController } from './service-offers.controller';
import { ServiceOffersService } from './service-offers.service';

/** a batch cooker's own service offers (length and price of a visit). */
@Module({
  imports: [UsersModule],
  controllers: [ServiceOffersController],
  providers: [ServiceOffersService],
})
export class ServiceOffersModule {}
