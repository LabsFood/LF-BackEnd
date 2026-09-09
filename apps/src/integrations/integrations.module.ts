import { Global, Module } from '@nestjs/common';

import { BrevoService } from './brevo.service';
import { ClerkService } from './clerk.service';
import { CronofyService } from './cronofy.service';
import { StreamService } from './stream.service';
import { StripeService } from './stripe.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [
    BrevoService,
    ClerkService,
    CronofyService,
    StreamService,
    StripeService,
    SupabaseService,
  ],
  exports: [
    BrevoService,
    ClerkService,
    CronofyService,
    StreamService,
    StripeService,
    SupabaseService,
  ],
})
export class IntegrationsModule {}
