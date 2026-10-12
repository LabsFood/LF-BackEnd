import { Injectable } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_COMMISSION_BPS, TAX_CREDIT_BPS } from './pricing.constants';

const COMMISSION_KEY = 'commission_bps';

/**
 * What an admin can change without a deploy. One thing today: the commission.
 *
 * Read from the database on every use, not cached: it is read when an offer is
 * priced, a handful of times a day, and a cached rate would let two API
 * instances price the same day's offers differently.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The commission in basis points (1500 = 15 %). */
  async commissionBps(): Promise<number> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: COMMISSION_KEY },
    });
    return typeof row?.value === 'number' ? row.value : DEFAULT_COMMISSION_BPS;
  }

  async pricingRules() {
    return { commissionBps: await this.commissionBps(), taxCreditBps: TAX_CREDIT_BPS };
  }

  async commission() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: COMMISSION_KEY },
    });
    return {
      commissionBps: typeof row?.value === 'number' ? row.value : DEFAULT_COMMISSION_BPS,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * Changes the rate for what is priced from now on. Offers already sent keep
   * the rate they were priced with: it is stored on each of them.
   */
  async setCommission(commissionBps: number, adminUserId: string, requestId?: string) {
    const previous = await this.commissionBps();
    const row = await this.prisma.platformSetting.upsert({
      where: { key: COMMISSION_KEY },
      update: { value: commissionBps, updatedByUserId: adminUserId },
      create: { key: COMMISSION_KEY, value: commissionBps, updatedByUserId: adminUserId },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'settings.commission_changed',
      subjectType: 'platform_setting',
      metadata: { from: previous, to: commissionBps },
      requestId,
    });
    return { commissionBps, updatedAt: row.updatedAt };
  }
}
