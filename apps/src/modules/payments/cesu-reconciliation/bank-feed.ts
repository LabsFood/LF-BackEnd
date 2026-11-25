/**
 * Reading the transfers received on the SAS account (Indy, held at Swan) through
 * GoCardless Bank Account Data, the free open-banking read access (decision 25/11/2026:
 * Indy read-only, payouts made by hand). Only credits matter: they are the CESU
 * remittances and URSSAF payments to reconcile.
 *
 * Credentials: `GOCARDLESS_BAD_SECRET_ID` / `GOCARDLESS_BAD_SECRET_KEY`, and the account
 * id the consent (requisition) returned, `CESU_BANK_ACCOUNT_ID`. Without them the feed
 * is off and nothing is read.
 */

const API = 'https://bankaccountdata.gocardless.com/api/v2';

/** A credit on the SAS account, as reconciliation needs it. */
export interface BankCredit {
  /** The bank's id, so the same transfer is never ingested twice. */
  transactionId: string;
  bookedOn: string;
  amountCents: number;
  /** Everything that can carry the booking reference, joined. */
  label: string;
}

interface GcTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  remittanceInformationStructured?: string;
  additionalInformation?: string;
  debtorName?: string;
}

export interface BankFeedConfig {
  secretId: string;
  secretKey: string;
  accountId: string;
}

export function bankFeedConfig(
  env: NodeJS.ProcessEnv = process.env,
): BankFeedConfig | null {
  const secretId = env.GOCARDLESS_BAD_SECRET_ID?.trim();
  const secretKey = env.GOCARDLESS_BAD_SECRET_KEY?.trim();
  const accountId = env.CESU_BANK_ACCOUNT_ID?.trim();
  return secretId && secretKey && accountId ? { secretId, secretKey, accountId } : null;
}

/** `"150.00"` → `15000`, without floating point. */
export function toCents(amount: string): number {
  const [whole, fraction = ''] = amount.trim().replace(/^\+/, '').split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const cents =
    Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return sign * cents;
}

/** Booked EUR credits only: debits, pending lines and other currencies are ignored. */
export function creditsFrom(transactions: readonly GcTransaction[]): BankCredit[] {
  return transactions.flatMap((t) => {
    const id = t.transactionId ?? t.internalTransactionId;
    const amountCents = toCents(t.transactionAmount.amount);
    if (!id || amountCents <= 0 || t.transactionAmount.currency !== 'EUR') return [];
    const label = [
      t.remittanceInformationUnstructured,
      ...(t.remittanceInformationUnstructuredArray ?? []),
      t.remittanceInformationStructured,
      t.additionalInformation,
      t.debtorName,
    ]
      .filter(Boolean)
      .join(' ');
    return [
      {
        transactionId: id,
        bookedOn: t.bookingDate ?? t.valueDate ?? '',
        amountCents,
        label,
      },
    ];
  });
}

type Fetch = typeof fetch;

/** The booked credits since `dateFrom` (YYYY-MM-DD). */
export async function fetchCredits(
  config: BankFeedConfig,
  dateFrom: string,
  http: Fetch = fetch,
): Promise<BankCredit[]> {
  const tokenResponse = await http(`${API}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ secret_id: config.secretId, secret_key: config.secretKey }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Bank feed: token refused (${tokenResponse.status}).`);
  }
  const { access } = (await tokenResponse.json()) as { access: string };

  const url = `${API}/accounts/${encodeURIComponent(config.accountId)}/transactions/?date_from=${dateFrom}`;
  const response = await http(url, {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    // 401/403 here usually means the bank consent expired (90 to 180 days): renew it.
    throw new Error(`Bank feed: transactions refused (${response.status}).`);
  }
  const body = (await response.json()) as { transactions?: { booked?: GcTransaction[] } };
  return creditsFrom(body.transactions?.booked ?? []);
}
