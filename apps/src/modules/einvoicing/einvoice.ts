/**
 * The e-invoice the SAS hands to an approved e-invoicing platform (plateforme agréée,
 * réforme 2026-2027). Platform-neutral: each provider maps it to its own payload
 * (UBL / CII / Factur-X are produced by the platform, not here).
 */
export interface EInvoiceParty {
  name: string;
  siren: string | null;
  address: string | null;
  /** Intra-EU VAT number, when the party has one. */
  vatNumber?: string | null;
}

export interface EInvoiceLine {
  description: string;
  quantity: number;
  unitPriceHtCents: number;
  /** 1000 = 10 %. 0 with `vatExemptionReason` for a franchise en base. */
  vatRateBps: number;
}

export type EInvoiceKind =
  /** Autofacture: the SAS buys the batch cooker's work (art. 289 I-2 CGI). */
  | 'self_billed'
  /** The SAS invoices the household in its own name (« prix net » flow). */
  | 'client';

export interface EInvoice {
  kind: EInvoiceKind;
  number: string;
  issueDate: string;
  currency: string;
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  lines: EInvoiceLine[];
  /** e.g. « TVA non applicable, article 293 B du CGI ». */
  vatExemptionReason?: string;
  /** Free notes printed on the invoice (autofacturation mention, SAP number...). */
  notes: string[];
}

export interface EInvoiceSubmission {
  /** False when no platform is configured: nothing left the API. */
  sent: boolean;
  provider: string;
  externalId: string | null;
  status: string;
}

/** One approved platform. */
export interface EInvoicingProvider {
  readonly name: string;
  submit(invoice: EInvoice): Promise<EInvoiceSubmission>;
}
