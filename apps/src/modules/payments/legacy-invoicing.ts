import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * The invoicing in place before the « prix net » flow: facture A (the client's invoice
 * in the batch cooker's name, card payments) and facture B (the commission invoice to
 * the batch cooker) with its SEPA debit.
 *
 * Switched off on 26/11/2026 (MajorD): the SAS is now the seller and invoices the
 * household itself, through a platform approved by the DGFiP (`modules/einvoicing`).
 * Nothing is deleted: the rows already issued stay readable and downloadable, and
 * `LEGACY_INVOICING_ENABLED=true` turns issuing and debiting back on.
 */
export const legacyInvoicingEnabled = (config: Pick<ConfigService, 'get'>): boolean =>
  config.get<boolean>('payments.legacyInvoicing') === true;

export function legacyInvoicingOff(): ConflictException {
  return new ConflictException({
    code: 'LEGACY_INVOICING_DISABLED',
    message:
      'The former invoices (client invoice in the batch cooker’s name, commission invoice ' +
      'and its SEPA debit) are switched off. Set LEGACY_INVOICING_ENABLED=true to use them.',
  });
}
