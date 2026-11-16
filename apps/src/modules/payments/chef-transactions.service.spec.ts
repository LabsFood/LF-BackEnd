import type { AuditService } from '../../common/audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { ChefTransactionsService } from './chef-transactions.service';
import type { CommissionDebitsService } from './commission-debits.service';

const CHEF = 'chef1';

const commission = (id: string, overrides: object = {}) => ({
  id,
  chefProfileId: CHEF,
  status: 'pending',
  collectionMethod: 'sepa_direct_debit',
  commissionInvoiceId: null,
  amountTtcCents: 1800,
  payment: { status: 'succeeded' },
  ...overrides,
});

function setup(opts: { commissions?: object[]; mandate?: string | null } = {}) {
  const prisma = {
    chefProfile: { findUnique: jest.fn().mockResolvedValue({ id: CHEF }) },
    commission: {
      findMany: jest.fn().mockResolvedValue(opts.commissions ?? [commission('c1')]),
    },
    sepaMandate: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.mandate === null ? null : { status: opts.mandate ?? 'active' },
        ),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const commissionDebits = {
    issueInvoiceForCommissions: jest.fn().mockResolvedValue({
      id: 'inv1',
      invoiceNumber: 'LF-COM-0001',
      amountTtcCents: 1800,
    }),
    executeDebit: jest
      .fn()
      .mockResolvedValue({ id: 'd1', status: 'processing', failureReason: null }),
  };
  const audit = { record: jest.fn() };
  const users = {
    ensurePersistedFromClerk: jest.fn().mockResolvedValue({ id: 'admin' }),
  };
  const service = new ChefTransactionsService(
    prisma as unknown as PrismaService,
    users as unknown as UsersService,
    commissionDebits as unknown as CommissionDebitsService,
    audit as unknown as AuditService,
  );
  return { service, prisma, commissionDebits, audit };
}

describe('ChefTransactionsService.collect', () => {
  it('invoices the commissions and starts the debit, audited', async () => {
    const { service, commissionDebits, audit } = setup();
    const result = await service.collect('clerk', CHEF, ['c1', 'c1']);

    expect(commissionDebits.issueInvoiceForCommissions).toHaveBeenCalledWith(['c1']);
    expect(commissionDebits.executeDebit).toHaveBeenCalledWith('inv1');
    expect(result).toEqual({
      invoice: { id: 'inv1', invoiceNumber: 'LF-COM-0001', amountTtcCents: 1800 },
      debit: { id: 'd1', status: 'processing', failureReason: null },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'commission.collect_manual',
        subjectType: 'chef_profile',
        subjectId: CHEF,
      }),
    );
  });

  it('refuses a commission of another chef', async () => {
    const { service, commissionDebits } = setup({
      commissions: [commission('c1', { chefProfileId: 'other' })],
    });
    await expect(service.collect('clerk', CHEF, ['c1'])).rejects.toMatchObject({
      response: { code: 'COMMISSION_NOT_COLLECTABLE', commissionIds: ['c1'] },
    });
    expect(commissionDebits.issueInvoiceForCommissions).not.toHaveBeenCalled();
  });

  it('refuses a commission on a prestation URSSAF has not paid yet', async () => {
    const { service } = setup({
      commissions: [commission('c1', { payment: { status: 'pending' } })],
    });
    await expect(service.collect('clerk', CHEF, ['c1'])).rejects.toMatchObject({
      response: { code: 'COMMISSION_NOT_COLLECTABLE' },
    });
  });

  it('refuses an unknown commission id', async () => {
    const { service } = setup({ commissions: [] });
    await expect(service.collect('clerk', CHEF, ['nope'])).rejects.toMatchObject({
      response: { code: 'COMMISSION_NOT_COLLECTABLE', commissionIds: ['nope'] },
    });
  });

  it('refuses without an active SEPA mandate, before any invoice', async () => {
    const { service, commissionDebits } = setup({ mandate: 'pending' });
    await expect(service.collect('clerk', CHEF, ['c1'])).rejects.toMatchObject({
      response: { code: 'SEPA_MANDATE_INACTIVE' },
    });
    expect(commissionDebits.issueInvoiceForCommissions).not.toHaveBeenCalled();
  });
});
