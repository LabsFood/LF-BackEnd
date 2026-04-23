import { Module } from '@nestjs/common';

import { BrevoService } from './brevo.service';
import { CronofyService } from './cronofy.service';
import { StreamService } from './stream.service';
import { StripeService } from './stripe.service';

@Module({
  providers: [BrevoService, CronofyService, StreamService, StripeService],
  exports: [BrevoService, CronofyService, StreamService, StripeService],
})
export class IntegrationsModule {}
