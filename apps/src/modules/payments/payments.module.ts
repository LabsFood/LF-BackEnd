import { Module } from '@nestjs/common';

import { ChefOnboardingModule } from '../chef-onboarding/chef-onboarding.module';
import { EInvoicingModule } from '../einvoicing/einvoicing.module';
import { UsersModule } from '../users/users.module';
import {
  AdminUrssafController,
  BookingPaymentsController,
} from './booking-payments.controller';
import { BookingPaymentsService } from './booking-payments.service';
import { CesuPaymentsController, PublicCesuController } from './cesu-payments.controller';
import { AdminChefTransactionsController } from './chef-transactions.controller';
import { ChefTransactionsService } from './chef-transactions.service';
import { CesuPaymentsService } from './cesu-payments.service';
import { CommissionDebitsService } from './commission-debits.service';
import { CommissionInvoicesController } from './commission-invoices.controller';
import { FiscalAttestationsController } from './fiscal-attestations.controller';
import { FiscalAttestationsService } from './fiscal-attestations.service';
import { PaymentInvoicesController } from './payment-invoices.controller';
import { PaymentInvoicesService } from './payment-invoices.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import {
  AdminChefPayoutsController,
  ChefPayoutStatementsController,
  ChefOwnPayoutsController,
} from './payouts/chef-payouts.controller';
import { PayoutStatementsService } from './payouts/payout-statements.service';
import { BankReconciliationService } from './payouts/bank-reconciliation.service';
import { ChefPayoutsService } from './payouts/chef-payouts.service';
import { SepaMandatesController } from './sepa-mandates.controller';
import { SepaMandatesService } from './sepa-mandates.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeConnectService } from './stripe-connect.service';
import { UrssafGateway } from './urssaf.gateway';
import {
  AdminUrssafDossiersController,
  UrssafDossiersController,
} from './urssaf-dossiers.controller';
import { UrssafDossiersService } from './urssaf-dossiers.service';

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
  // ChefOnboardingModule lends its private-bucket storage to the e-CESU proofs and
  // the clients' sealed URSSAF dossiers.
  imports: [UsersModule, ChefOnboardingModule, EInvoicingModule],
  controllers: [
    PaymentsController,
    BookingPaymentsController,
    AdminUrssafController,
    UrssafDossiersController,
    AdminUrssafDossiersController,
    AdminChefTransactionsController,
    PublicCesuController,
    CesuPaymentsController,
    CommissionInvoicesController,
    StripeConnectController,
    SepaMandatesController,
    FiscalAttestationsController,
    PaymentInvoicesController,
    AdminChefPayoutsController,
    ChefPayoutStatementsController,
    ChefOwnPayoutsController,
  ],
  providers: [
    PaymentsService,
    BookingPaymentsService,
    UrssafGateway,
    UrssafDossiersService,
    ChefTransactionsService,
    CesuPaymentsService,
    CommissionDebitsService,
    StripeConnectService,
    SepaMandatesService,
    FiscalAttestationsService,
    PaymentInvoicesService,
    ChefPayoutsService,
    BankReconciliationService,
    PayoutStatementsService,
  ],
  exports: [
    PaymentsService,
    BookingPaymentsService,
    CesuPaymentsService,
    CommissionDebitsService,
    StripeConnectService,
    SepaMandatesService,
  ],
})
export class PaymentsModule {}
