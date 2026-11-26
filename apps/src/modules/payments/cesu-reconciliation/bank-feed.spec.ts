import { bankFeedConfig, creditsFrom, fetchCredits, toCents } from './bank-feed';

describe('toCents', () => {
  it.each([
    ['150.00', 15000],
    ['150.5', 15050],
    ['+12', 1200],
    ['-80.25', -8025],
  ])('reads %s as %d cents', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });
});

describe('creditsFrom', () => {
  it('keeps booked EUR credits and joins every label field', () => {
    expect(
      creditsFrom([
        {
          transactionId: 't1',
          bookingDate: '2026-11-26',
          transactionAmount: { amount: '150.00', currency: 'EUR' },
          remittanceInformationUnstructuredArray: ['CRCESU REMISE', 'LF-2026-0042'],
          debtorName: 'CRCESU',
        },
        { transactionId: 't2', transactionAmount: { amount: '-20.00', currency: 'EUR' } },
        { transactionId: 't3', transactionAmount: { amount: '10.00', currency: 'GBP' } },
        { transactionAmount: { amount: '10.00', currency: 'EUR' } },
      ]),
    ).toEqual([
      {
        transactionId: 't1',
        bookedOn: '2026-11-26',
        amountCents: 15000,
        label: 'CRCESU REMISE LF-2026-0042 CRCESU',
      },
    ]);
  });
});

describe('bankFeedConfig', () => {
  it('is off until the three settings are present', () => {
    expect(bankFeedConfig({ GOCARDLESS_BAD_SECRET_ID: 'a' })).toBeNull();
    expect(
      bankFeedConfig({
        GOCARDLESS_BAD_SECRET_ID: 'a',
        GOCARDLESS_BAD_SECRET_KEY: 'b',
        CESU_BANK_ACCOUNT_ID: 'c',
      }),
    ).toEqual({ secretId: 'a', secretKey: 'b', accountId: 'c' });
  });
});

describe('fetchCredits', () => {
  const config = { secretId: 'id', secretKey: 'key', accountId: 'acc 1' };
  const json = (status: number, body: unknown) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

  it('gets a token, then the booked transactions since the date', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(json(200, { access: 'tok' }))
      .mockResolvedValueOnce(
        json(200, {
          transactions: {
            booked: [
              {
                transactionId: 't1',
                bookingDate: '2026-11-26',
                transactionAmount: { amount: '80.00', currency: 'EUR' },
                remittanceInformationUnstructured: 'LF20260107',
              },
            ],
          },
        }),
      );
    await expect(fetchCredits(config, '2026-11-20', http)).resolves.toEqual([
      {
        transactionId: 't1',
        bookedOn: '2026-11-26',
        amountCents: 8000,
        label: 'LF20260107',
      },
    ]);
    expect(http.mock.calls[1][0]).toBe(
      'https://bankaccountdata.gocardless.com/api/v2/accounts/acc%201/transactions/?date_from=2026-11-20',
    );
    expect(http.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('says so when the bank consent is no longer valid', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(json(200, { access: 'tok' }))
      .mockResolvedValueOnce(json(403, {}));
    await expect(fetchCredits(config, '2026-11-20', http)).rejects.toThrow(
      'transactions refused (403)',
    );
  });
});
