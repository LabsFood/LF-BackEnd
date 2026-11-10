import { Injectable } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { ChefTier } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SUPPLEMENTS_KEY,
  SupplementRules,
  supplementRulesInForce,
} from '../bookings/domain/pricing';
import { validationFailed } from '../dishes/domain/content.errors';
import { CHEF_TIERS_KEY, chefTierLabels, chefTierRules } from './chef-tiers';
import {
  DEFAULT_RECIPE_PROFILES,
  DEFAULT_REHEAT_MODES,
  ListItem,
  listInForce,
  RECIPE_PROFILES_KEY,
  recipeProfilesInForce,
  REHEAT_MODES_KEY,
  reheatModesInForce,
} from './recipe-lists';
import { DEFAULT_COMMISSION_BPS, TAX_CREDIT_BPS } from './pricing.constants';

const COMMISSION_KEY = 'commission_bps';

/**
 * What an admin can change without a deploy: the commission, the booking
 * supplements (adults beyond what an offer covers, extra dishes), the names of
 * the chef tiers, and the lists a recipe picks from (reheating modes, profiles).
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
      rules: chefTierRules(await this.commissionBps()),
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

  async reheatModes() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: REHEAT_MODES_KEY },
    });
    return {
      modes: await reheatModesInForce(this.prisma),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * Recettes §4.6. The whole list, every time. A dish keeps a code that leaves the
   * list (the fronts show the code); it no longer accepts it when saved again.
   */
  async setReheatModes(modes: ListItem[], adminUserId: string, requestId?: string) {
    const saved = await this.setList(
      REHEAT_MODES_KEY,
      DEFAULT_REHEAT_MODES,
      modes,
      'settings.reheat_modes_changed',
      adminUserId,
      requestId,
    );
    return { modes: saved.value, updatedAt: saved.updatedAt };
  }

  async recipeProfiles() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: RECIPE_PROFILES_KEY },
    });
    return {
      profiles: await recipeProfilesInForce(this.prisma),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Recettes §4.8. Same rules as the reheating modes. */
  async setRecipeProfiles(profiles: ListItem[], adminUserId: string, requestId?: string) {
    const saved = await this.setList(
      RECIPE_PROFILES_KEY,
      DEFAULT_RECIPE_PROFILES,
      profiles,
      'settings.recipe_profiles_changed',
      adminUserId,
      requestId,
    );
    return { profiles: saved.value, updatedAt: saved.updatedAt };
  }

  /** An editable list: each code once, saved whole, journalled before and after. */
  private async setList(
    key: string,
    defaults: ListItem[],
    items: ListItem[],
    action: string,
    adminUserId: string,
    requestId?: string,
  ) {
    assertUniqueCodes(items);
    const previous = await listInForce(this.prisma, key, defaults);
    const value = items.map(({ code, label }) => ({ code, label }));
    const row = await this.prisma.platformSetting.upsert({
      where: { key },
      update: { value, updatedByUserId: adminUserId },
      create: { key, value, updatedByUserId: adminUserId },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action,
      subjectType: 'platform_setting',
      metadata: { from: previous, to: value },
      requestId,
    });
    return { value, updatedAt: row.updatedAt };
  }
}

function assertUniqueCodes(items: ListItem[]): void {
  const seen = new Set<string>();
  const twice = items.filter(({ code }) => seen.has(code) || !seen.add(code));
  if (twice.length) {
    throw validationFailed(`Each code once: ${twice.map((i) => i.code).join(', ')}.`);
  }
}
