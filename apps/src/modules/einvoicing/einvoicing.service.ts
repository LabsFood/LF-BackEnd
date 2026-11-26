import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { B2BrouterConfig } from './b2brouter.provider';
import { B2BrouterProvider } from './b2brouter.provider';
import { DisabledEInvoicingProvider } from './disabled.provider';
import type { EInvoice, EInvoiceSubmission, EInvoicingProvider } from './einvoice';

/**
 * Hands the SAS's invoices to the approved e-invoicing platform chosen by
 * `EINVOICING_PROVIDER`. Off (`none`) by default: callers get `sent: false`.
 */
@Injectable()
export class EInvoicingService {
  private readonly logger = new Logger(EInvoicingService.name);
  private readonly provider: EInvoicingProvider;

  constructor(config: ConfigService) {
    const name = config.get<'none' | 'b2brouter'>('einvoicing.provider') ?? 'none';
    this.provider =
      name === 'b2brouter'
        ? new B2BrouterProvider(
            config.getOrThrow<B2BrouterConfig>('einvoicing.b2brouter'),
          )
        : new DisabledEInvoicingProvider();
  }

  get enabled(): boolean {
    return this.provider.name !== 'none';
  }

  async submit(invoice: EInvoice): Promise<EInvoiceSubmission> {
    const result = await this.provider.submit(invoice);
    if (result.sent) {
      this.logger.log(
        `E-invoice ${invoice.number} sent to ${result.provider} (${result.status})`,
      );
    }
    return result;
  }
}
