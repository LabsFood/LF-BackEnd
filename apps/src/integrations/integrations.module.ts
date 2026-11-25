import { Global, Module } from '@nestjs/common';

import { BrevoService } from './brevo.service';
import { ClerkService } from './clerk.service';
import { GeoService } from './geo.service';
import { R2StorageService } from './r2-storage.service';
import { StripeService } from './stripe.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [
    BrevoService,
    ClerkService,
    GeoService,
    R2StorageService,
    StripeService,
    SupabaseService,
  ],
  exports: [
    BrevoService,
    ClerkService,
    GeoService,
    R2StorageService,
    StripeService,
    SupabaseService,
  ],
})
export class IntegrationsModule {}
