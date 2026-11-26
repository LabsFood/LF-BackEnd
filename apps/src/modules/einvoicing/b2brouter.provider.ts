import { Logger, ServiceUnavailableException } from '@nestjs/common';

import type {
  EInvoice,
  EInvoiceLine,
  EInvoiceSubmission,
  EInvoicingProvider,
} from './einvoice';

/**
 * B2Brouter, approved platform (PA). Start on the sandbox (free), then production.
 *
 * À VÉRIFIER avec la doc B2Brouter avant la première mise en service (rien n'est
 * appelé tant que `EINVOICING_PROVIDER=none`) : hôtes, en-tête d'authentification,
 * version d'API, forme exacte du corps et code du type « autofacture » (UNTDID 1001
 * code 389).
 */
const HOSTS = {
  sandbox: 'https://api-staging.b2brouter.net',
  production: 'https://api.b2brouter.net',
} as const;

const TIMEOUT_MS = 15_000;
/** UNTDID 1001: 380 commercial invoice, 389 self-billed invoice. */
const DOCUMENT_TYPE = { client: '380', self_billed: '389' } as const;

export interface B2BrouterConfig {
  env: 'sandbox' | 'production';
  apiKey: string;
  accountId: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class B2BrouterProvider implements EInvoicingProvider {
  readonly name = 'b2brouter';
  private readonly logger = new Logger(B2BrouterProvider.name);

  constructor(
    private readonly config: B2BrouterConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get configured(): boolean {
    return this.config.apiKey !== '' && this.config.accountId !== '';
  }

  async submit(invoice: EInvoice): Promise<EInvoiceSubmission> {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'EINVOICING_NOT_CONFIGURED',
        message: 'B2Brouter : clé API ou compte manquant.',
      });
    }
    const url = `${HOSTS[this.config.env]}/accounts/${encodeURIComponent(
      this.config.accountId,
    )}/invoices.json`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-B2B-API-Key': this.config.apiKey,
      },
      body: JSON.stringify({ invoice: toB2BrouterInvoice(invoice) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The body may echo invoice data: log the status only.
      this.logger.error(
        `B2Brouter refused invoice ${invoice.number}: HTTP ${response.status}`,
      );
      throw new ServiceUnavailableException({
        code: 'EINVOICING_REJECTED',
        message: `La plateforme de facturation a refusé la facture (HTTP ${response.status}).`,
      });
    }
    const body = (await response.json()) as {
      invoice?: { id?: unknown; state?: unknown };
    };
    return {
      sent: true,
      provider: this.name,
      externalId: body.invoice?.id != null ? String(body.invoice.id) : null,
      status: typeof body.invoice?.state === 'string' ? body.invoice.state : 'submitted',
    };
  }
}

const euros = (cents: number): number => cents / 100;

const toLine = (line: EInvoiceLine) => ({
  description: line.description,
  quantity: line.quantity,
  price: euros(line.unitPriceHtCents),
  taxes_attributes: [
    {
      name: 'TVA',
      category: line.vatRateBps === 0 ? 'E' : 'S',
      percent: line.vatRateBps / 100,
    },
  ],
});

/** Maps the neutral e-invoice to B2Brouter's invoice body (field names à vérifier). */
export function toB2BrouterInvoice(invoice: EInvoice): Record<string, unknown> {
  return {
    number: invoice.number,
    date: invoice.issueDate.slice(0, 10),
    currency: invoice.currency.toUpperCase(),
    document_type_code: DOCUMENT_TYPE[invoice.kind],
    contact: {
      name: invoice.buyer.name,
      tin_scheme: invoice.buyer.siren ? '0002' : undefined,
      tin_value: invoice.buyer.siren ?? undefined,
      address: invoice.buyer.address ?? undefined,
      country: 'fr',
    },
    seller: {
      name: invoice.seller.name,
      tin_value: invoice.seller.siren ?? undefined,
      address: invoice.seller.address ?? undefined,
    },
    tax_exemption_reason: invoice.vatExemptionReason,
    extra_info: invoice.notes.join('\n'),
    invoice_lines_attributes: invoice.lines.map(toLine),
  };
}
