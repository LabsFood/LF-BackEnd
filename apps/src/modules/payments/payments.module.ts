import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { FiscalAttestationsController } from './fiscal-attestations.controller';
import { FiscalAttestationsService } from './fiscal-attestations.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SepaMandatesController } from './sepa-mandates.controller';
import { SepaMandatesService } from './sepa-mandates.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeConnectService } from './stripe-connect.service';

/**
 * Everything that touches money: card payments, the platform commission, the chef's
 * Stripe Connect account, and the commission direct-debit mandate. `StripeService`
 * arrives through the `@Global()` IntegrationsModule, so no import is needed for it.
 *
 * The chef's SAP declaration lives in `UsersModule` instead — it is self-declared
 * profile data, like the chef profile itself, and carries no Stripe secrets.
 */
@Module({
  imports: [UsersModule],
  controllers: [
    PaymentsController,
    StripeConnectController,
    SepaMandatesController,
    FiscalAttestationsController,
  ],
  providers: [
    PaymentsService,
    StripeConnectService,
    SepaMandatesService,
    FiscalAttestationsService,
  ],
  exports: [PaymentsService, StripeConnectService, SepaMandatesService],
})
export class PaymentsModule {}
