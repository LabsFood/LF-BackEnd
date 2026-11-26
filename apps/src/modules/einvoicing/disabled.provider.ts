import type { EInvoice, EInvoiceSubmission, EInvoicingProvider } from './einvoice';

/** `EINVOICING_PROVIDER=none`: nothing is transmitted, the PDF stays the only copy. */
export class DisabledEInvoicingProvider implements EInvoicingProvider {
  readonly name = 'none';

  submit(_invoice: EInvoice): Promise<EInvoiceSubmission> {
    return Promise.resolve({
      sent: false,
      provider: this.name,
      externalId: null,
      status: 'disabled',
    });
  }
}
