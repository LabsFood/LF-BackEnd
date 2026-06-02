import { Global, Module } from '@nestjs/common';

import { BrevoService } from './brevo.service';
import { CronofyService } from './cronofy.service';
import { StreamService } from './stream.service';
import { StripeService } from './stripe.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [
    BrevoService,
    CronofyService,
    StreamService,
    StripeService,
    SupabaseService,
  ],
  exports: [BrevoService, CronofyService, StreamService, StripeService, SupabaseService],
})
export class IntegrationsModule {}
