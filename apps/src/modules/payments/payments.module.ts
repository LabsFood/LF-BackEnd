import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { UsersModule } from '../users/users.module';
import {
  AdminUrssafController,
  BookingPaymentsController,
} from './booking-payments.controller';
import { BookingPaymentsService } from './booking-payments.service';
import { CesuPaymentsController, PublicCesuController } from './cesu-payments.controller';
import { CesuPaymentsService } from './cesu-payments.service';
import { CommissionDebitsService } from './commission-debits.service';
import { CommissionInvoicesController } from './commission-invoices.controller';
import { FiscalAttestationsController } from './fiscal-attestations.controller';
import { FiscalAttestationsService } from './fiscal-attestations.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SepaMandatesController } from './sepa-mandates.controller';
import { SepaMandatesService } from './sepa-mandates.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeConnectService } from './stripe-connect.service';
import { UrssafGateway } from './urssaf.gateway';

/**
 * Everything that touches money: card payments, prefinanced CESU, the URSSAF
 * immediate advance (simulated, behind `UrssafGateway`), the platform
 * commission and its SEPA direct debit, the chef's Stripe Connect account, and the
 * commission mandate. `StripeService` arrives through the `@Global()`
 * IntegrationsModule, so no import is needed for it.
 *
 * The chef's SAP declaration lives in `UsersModule` instead — it is self-declared
 * profile data, like the chef profile itself, and carries no Stripe secrets.
 */
@Module({
  // ChefOnboardingModule lends its private-bucket storage to the e-CESU proofs.
  imports: [UsersModule, ChefOnboardingModule],
  controllers: [
    PaymentsController,
    BookingPaymentsController,
    AdminUrssafController,
    PublicCesuController,
    CesuPaymentsController,
    CommissionInvoicesController,
    StripeConnectController,
    SepaMandatesController,
    FiscalAttestationsController,
  ],
  providers: [
    PaymentsService,
    BookingPaymentsService,
    UrssafGateway,
    CesuPaymentsService,
    CommissionDebitsService,
    StripeConnectService,
    SepaMandatesService,
    FiscalAttestationsService,
  ],
  exports: [
    PaymentsService,
    CesuPaymentsService,
    CommissionDebitsService,
    StripeConnectService,
    SepaMandatesService,
  ],
})
export class PaymentsModule {}
