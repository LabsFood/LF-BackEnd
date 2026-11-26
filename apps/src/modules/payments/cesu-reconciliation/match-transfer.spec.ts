import {
  canonicalReference,
  matchTransfer,
  referencesInLabel,
  sameAmountCandidates,
} from './match-transfer';

const open = [
  { paymentId: 'p1', bookingReference: 'LF-2026-0042', amountCents: 15000 },
  { paymentId: 'p2', bookingReference: 'LF-2026-0107', amountCents: 8000 },
  { paymentId: 'p3', bookingReference: null, amountCents: 8000 },
];

describe('canonicalReference', () => {
  it('drops dashes and leading zeros', () => {
    expect(canonicalReference('LF-2026-0042')).toBe('LF202642');
  });

  it('rejects anything that is not a booking reference', () => {
    expect(canonicalReference('FACT-12')).toBeNull();
  });
});

describe('referencesInLabel', () => {
  it('finds a reference typed loosely', () => {
    expect(referencesInLabel('VIR CRCESU lf 2026 0042 EDENRED')).toEqual(['LF202642']);
  });

  it('finds nothing in a label without a reference', () => {
    expect(referencesInLabel('VIR CRCESU REMISE 88321')).toEqual([]);
  });
});

describe('matchTransfer', () => {
  it('matches a transfer whose reference and amount agree', () => {
    expect(
      matchTransfer({ amountCents: 15000, label: 'CESU LF-2026-0042' }, open),
    ).toEqual({
      kind: 'matched',
      paymentId: 'p1',
    });
  });

  it('flags an amount that differs from the declaration', () => {
    expect(matchTransfer({ amountCents: 12000, label: 'LF20260042' }, open)).toEqual({
      kind: 'amount_mismatch',
      paymentId: 'p1',
      expectedCents: 15000,
    });
  });

  it('flags a reference with no open declaration', () => {
    expect(matchTransfer({ amountCents: 5000, label: 'LF-2026-0999' }, open)).toEqual({
      kind: 'unknown_reference',
      reference: 'LF2026999',
    });
  });

  it('never settles on the amount alone', () => {
    expect(matchTransfer({ amountCents: 15000, label: 'VIR CRCESU' }, open)).toEqual({
      kind: 'unidentified',
    });
  });
});

describe('sameAmountCandidates', () => {
  it('lists every open declaration with that amount for the admin', () => {
    expect(
      sameAmountCandidates({ amountCents: 8000, label: '' }, open).map(
        (d) => d.paymentId,
      ),
    ).toEqual(['p2', 'p3']);
  });
});
