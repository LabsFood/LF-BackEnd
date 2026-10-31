import { Injectable } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { ChefTier } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SUPPLEMENTS_KEY,
  SupplementRules,
  supplementRulesInForce,
} from '../bookings/domain/pricing';
import { CHEF_TIERS_KEY, chefTierLabels } from './chef-tiers';
import { DEFAULT_COMMISSION_BPS, TAX_CREDIT_BPS } from './pricing.constants';

const COMMISSION_KEY = 'commission_bps';

/**
 * What an admin can change without a deploy: the commission, the booking
 * supplements (adults beyond what an offer covers, extra dishes), and the names of
 * the chef tiers.
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

  async bookingSupplements() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: SUPPLEMENTS_KEY },
    });
    return {
      ...(await supplementRulesInForce(this.prisma)),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** For bookings made, or changed, from now on: a booking keeps the lines it has. */
  async setBookingSupplements(
    rules: SupplementRules,
    adminUserId: string,
    requestId?: string,
  ) {
    const previous = await supplementRulesInForce(this.prisma);
    const value = {
      includedPersons: rules.includedPersons,
      extraPersonCents: rules.extraPersonCents,
      extraMealCents: rules.extraMealCents,
    };
    const row = await this.prisma.platformSetting.upsert({
      where: { key: SUPPLEMENTS_KEY },
      update: { value, updatedByUserId: adminUserId },
      create: { key: SUPPLEMENTS_KEY, value, updatedByUserId: adminUserId },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'settings.booking_supplements_changed',
      subjectType: 'platform_setting',
      metadata: { from: { ...previous }, to: value },
      requestId,
    });
    return { ...value, updatedAt: row.updatedAt };
  }

  async chefTiers() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: CHEF_TIERS_KEY },
    });
    return {
      labels: await chefTierLabels(this.prisma),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Renames the tiers: the codes stored on each batch cooker never change. */
  async setChefTiers(
    labels: Record<ChefTier, string>,
    adminUserId: string,
    requestId?: string,
  ) {
    const previous = await chefTierLabels(this.prisma);
    const value = {
      tier_1: labels.tier_1,
      tier_2: labels.tier_2,
      tier_3: labels.tier_3,
      tier_4: labels.tier_4,
    };
    const row = await this.prisma.platformSetting.upsert({
      where: { key: CHEF_TIERS_KEY },
      update: { value, updatedByUserId: adminUserId },
      create: { key: CHEF_TIERS_KEY, value, updatedByUserId: adminUserId },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'settings.chef_tiers_changed',
      subjectType: 'platform_setting',
      metadata: { from: previous, to: value },
      requestId,
    });
    return { labels: value, updatedAt: row.updatedAt };
  }
}
