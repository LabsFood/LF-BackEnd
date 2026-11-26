/**
 * Automatic CESU reconciliation (25/11/2026): which declared CESU payment an incoming
 * bank transfer pays.
 *
 * The client types the booking reference (`LF-2026-0042`) on their issuer's portal, and
 * it travels in the transfer label. Clients type it loosely (`lf20260042`,
 * `LF 2026 42`), so the label is normalised before looking for it. A transfer is matched
 * only when the reference **and** the amount agree with one open declaration; anything
 * else becomes an exception for an admin, never a guess.
 */

/** A transfer received on the account the platform NAN pays into. */
export interface IncomingTransfer {
  amountCents: number;
  label: string;
}

/** A CESU payment the client declared and the platform has not received yet. */
export interface OpenDeclaration {
  paymentId: string;
  bookingReference: string | null;
  amountCents: number;
}

export type TransferMatch =
  | { kind: 'matched'; paymentId: string }
  /** The reference was found, but the amount differs from what the client declared. */
  | { kind: 'amount_mismatch'; paymentId: string; expectedCents: number }
  /** The label names a booking with no open CESU declaration. */
  | { kind: 'unknown_reference'; reference: string }
  /** No reference in the label, and no single declaration with that exact amount. */
  | { kind: 'unidentified' };

const REFERENCE_IN_LABEL = /LF(\d{4})(\d{1,6})/g;

/** `LF-2026-0042` → `LF20260042`, so a label and a reference compare alike. */
export function canonicalReference(reference: string): string | null {
  const match = /^LF-?(\d{4})-?(\d{1,6})$/i.exec(reference.trim());
  return match ? `LF${match[1]}${Number(match[2])}` : null;
}

/** Every booking reference a transfer label carries, canonical. */
export function referencesInLabel(label: string): string[] {
  const compact = label.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return [...compact.matchAll(REFERENCE_IN_LABEL)].map(
    ([, year, serial]) => `LF${year}${Number(serial)}`,
  );
}

export function matchTransfer(
  transfer: IncomingTransfer,
  open: readonly OpenDeclaration[],
): TransferMatch {
  const byReference = new Map<string, OpenDeclaration>();
  for (const declaration of open) {
    const canonical = declaration.bookingReference
      ? canonicalReference(declaration.bookingReference)
      : null;
    if (canonical) byReference.set(canonical, declaration);
  }

  const references = referencesInLabel(transfer.label);
  for (const reference of references) {
    const declaration = byReference.get(reference);
    if (!declaration) continue;
    return declaration.amountCents === transfer.amountCents
      ? { kind: 'matched', paymentId: declaration.paymentId }
      : {
          kind: 'amount_mismatch',
          paymentId: declaration.paymentId,
          expectedCents: declaration.amountCents,
        };
  }
  if (references.length > 0) {
    return { kind: 'unknown_reference', reference: references[0] };
  }
  // No usable reference: an exact amount shared by no other declaration is not enough
  // to settle money in a chef's name, so it is only a suggestion for the admin.
  return { kind: 'unidentified' };
}

/** For the exception queue: open declarations with exactly this amount. */
export const sameAmountCandidates = (
  transfer: IncomingTransfer,
  open: readonly OpenDeclaration[],
): OpenDeclaration[] => open.filter((d) => d.amountCents === transfer.amountCents);
