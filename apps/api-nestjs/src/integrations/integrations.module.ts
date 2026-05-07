import { Global, Module } from '@nestjs/common';

import { BrevoService } from './brevo.service';
import { CronofyService } from './cronofy.service';
import { StreamService } from './stream.service';
import { StripeService } from './stripe.service';

@Global()
@Module({
  providers: [BrevoService, CronofyService, StreamService, StripeService],
  exports: [BrevoService, CronofyService, StreamService, StripeService],
})
export class IntegrationsModule {}
