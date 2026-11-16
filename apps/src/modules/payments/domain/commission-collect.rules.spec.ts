import {
  commissionCollectable,
  transactionTotals,
  type CollectableFacts,
} from './commission-collect.rules';

const DUE: CollectableFacts = {
  status: 'pending',
  collectionMethod: 'sepa_direct_debit',
  commissionInvoiceId: null,
  paymentStatus: 'succeeded',
};

describe('commission-collect rules', () => {
  it('collects a pending direct-debit commission on a paid prestation', () => {
    expect(commissionCollectable(DUE)).toBe(true);
  });

  it('never collects before URSSAF paid the batch cooker', () => {
    expect(commissionCollectable({ ...DUE, paymentStatus: 'pending' })).toBe(false);
    expect(commissionCollectable({ ...DUE, paymentStatus: 'failed' })).toBe(false);
  });

  it('never collects twice, nor a card commission taken at charge time', () => {
    expect(commissionCollectable({ ...DUE, commissionInvoiceId: 'inv1' })).toBe(false);
    expect(commissionCollectable({ ...DUE, status: 'invoiced' })).toBe(false);
    expect(
      commissionCollectable({ ...DUE, collectionMethod: 'stripe_application_fee' }),
    ).toBe(false);
  });

  it('totals the commissions per status, and what can be collected now', () => {
    expect(
      transactionTotals([
        { ...DUE, amountTtcCents: 1800 },
        { ...DUE, amountTtcCents: 1200 },
        { ...DUE, paymentStatus: 'pending', amountTtcCents: 900 },
        { ...DUE, status: 'collected', commissionInvoiceId: 'i', amountTtcCents: 600 },
      ]),
    ).toEqual({
      byStatus: {
        pending: { count: 3, amountTtcCents: 3900 },
        collected: { count: 1, amountTtcCents: 600 },
      },
      collectable: { count: 2, amountTtcCents: 3000 },
    });
  });
});
