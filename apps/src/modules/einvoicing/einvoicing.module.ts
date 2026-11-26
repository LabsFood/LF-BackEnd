import { Module } from '@nestjs/common';

import { EInvoicingService } from './einvoicing.service';

/** Bridge to the approved e-invoicing platform (B2Brouter first, sandbox). */
@Module({
  providers: [EInvoicingService],
  exports: [EInvoicingService],
})
export class EInvoicingModule {}
