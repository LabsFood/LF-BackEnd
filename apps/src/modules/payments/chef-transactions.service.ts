import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { mandateActive } from './chef-cesu-info';
import { CommissionDebitsService } from './commission-debits.service';
import {
  commissionCollectable,
  transactionTotals,
} from './domain/commission-collect.rules';

/**
 * A batch cooker's transactions as the team sees them: every payment on their
 * bookings with the platform commission taken on it, and the manual debit of those
 * commissions (immediate advance, manual route: `onCommissionDue` is not called
 * when URSSAF pays, the admin collects from here).
 */
@Injectable()
export class ChefTransactionsService {
  private readonly logger = new Logger(ChefTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly commissionDebits: CommissionDebitsService,
    private readonly audit: AuditService,
  ) {}

  /** `GET /admin/chefs/{id}/transactions`: collectable commissions first. */
  async transactions(chefProfileId: string) {
    await this.assertChef(chefProfileId);
    const payments = await this.prisma.payment.findMany({
      where: { booking: { chefProfileId } },
      include: {
        booking: {
          select: {
            id: true,
            reference: true,
            startsAt: true,
            client: { select: { fullName: true, email: true } },
          },
        },
        commission: {
          include: {
            commissionInvoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                debits: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    status: true,
                    failureReason: true,
                    initiatedAt: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      // ponytail: newest 200, like the other admin queues; paginate when a chef has more.
      take: 200,
    });

    const rows = payments.map((payment) => {
      const meta = (payment.metadata ?? {}) as {
        urssafReference?: string | null;
        externalReference?: string;
      };
      const c = payment.commission;
      const facts = c && {
        status: c.status,
        collectionMethod: c.collectionMethod,
        commissionInvoiceId: c.commissionInvoiceId,
        paymentStatus: payment.status,
      };
      return {
        paymentId: payment.id,
        method: payment.method,
        purpose: payment.purpose,
        status: payment.status,
        amountCents: payment.amountTtc,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
        urssafReference: meta.urssafReference ?? null,
        externalReference: meta.externalReference ?? null,
        booking: {
          id: payment.booking.id,
          reference: payment.booking.reference,
          startsAt: payment.booking.startsAt,
          clientName: payment.booking.client.fullName ?? payment.booking.client.email,
        },
        commission: c && {
          id: c.id,
          status: c.status,
          collectionMethod: c.collectionMethod,
          amountTtcCents: c.amountTtcCents,
          collectable: commissionCollectable(facts!),
          invoice: c.commissionInvoice && {
            id: c.commissionInvoice.id,
            invoiceNumber: c.commissionInvoice.invoiceNumber,
            status: c.commissionInvoice.status,
          },
          lastDebit: c.commissionInvoice?.debits[0] ?? null,
        },
      };
    });
    // Stable: collectable first, newest first within each group.
    rows.sort(
      (a, b) => Number(!!b.commission?.collectable) - Number(!!a.commission?.collectable),
    );

    return {
      chefProfileId,
      totals: transactionTotals(
        payments.flatMap((p) =>
          p.commission
            ? [
                {
                  status: p.commission.status,
                  collectionMethod: p.commission.collectionMethod,
                  commissionInvoiceId: p.commission.commissionInvoiceId,
                  paymentStatus: p.status,
                  amountTtcCents: p.commission.amountTtcCents,
                },
              ]
            : [],
        ),
      ),
      transactions: rows,
    };
  }

  /**
   * `POST /admin/chefs/{id}/commissions/collect`: one facture B for the chosen
   * commissions, then its SEPA debit, through the commission engine.
   */
  async collect(
    adminClerkUserId: string,
    chefProfileId: string,
    commissionIds: string[],
    requestId?: string,
  ) {
    const admin = await this.users.ensurePersistedFromClerk(adminClerkUserId);
    await this.assertChef(chefProfileId);
    const ids = [...new Set(commissionIds)];

    const commissions = await this.prisma.commission.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        chefProfileId: true,
        status: true,
        collectionMethod: true,
        commissionInvoiceId: true,
        payment: { select: { status: true } },
      },
    });
    const ok = new Set(
      commissions
        .filter(
          (c) =>
            c.chefProfileId === chefProfileId &&
            commissionCollectable({ ...c, paymentStatus: c.payment.status }),
        )
        .map((c) => c.id),
    );
    const refused = ids.filter((id) => !ok.has(id));
    if (refused.length > 0) {
      throw new ConflictException({
        code: 'COMMISSION_NOT_COLLECTABLE',
        message:
          'Only pending direct-debit commissions of this batch cooker, on a paid prestation, can be collected.',
        commissionIds: refused,
      });
    }

    const mandate = await this.prisma.sepaMandate.findUnique({
      where: { chefProfileId },
      select: { status: true },
    });
    if (!mandateActive(mandate)) {
      throw new ConflictException({
        code: 'SEPA_MANDATE_INACTIVE',
        message: 'This batch cooker has no active SEPA mandate to debit.',
      });
    }

    const invoice = await this.commissionDebits.issueInvoiceForCommissions(ids);
    const debit = await this.commissionDebits.executeDebit(invoice.id);

    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'commission.collect_manual',
      subjectType: 'chef_profile',
      subjectId: chefProfileId,
      metadata: {
        commissionIds: ids,
        invoiceId: invoice.id,
        debitId: debit.id,
        debitStatus: debit.status,
      },
      requestId,
    });
    this.logger.log({
      event: 'commission.collect_manual',
      chefProfileId,
      invoiceId: invoice.id,
      commissions: ids.length,
      debitStatus: debit.status,
    });

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amountTtcCents: invoice.amountTtcCents,
      },
      debit: { id: debit.id, status: debit.status, failureReason: debit.failureReason },
    };
  }

  private async assertChef(chefProfileId: string): Promise<void> {
    const chef = await this.prisma.chefProfile.findUnique({
      where: { id: chefProfileId },
      select: { id: true },
    });
    if (!chef) throw new NotFoundException('No batch cooker with this id.');
  }
}
