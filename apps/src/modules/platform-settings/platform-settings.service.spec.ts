import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSettingsService } from './platform-settings.service';

const UPDATED_AT = new Date('2026-10-31T09:00:00.000Z');

function harness(saved: unknown = null) {
  const prisma = {
    platformSetting: {
      findUnique: jest.fn(async () =>
        saved === null ? null : { value: saved, updatedAt: UPDATED_AT },
      ),
      upsert: jest.fn(async () => ({ updatedAt: UPDATED_AT })),
    },
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new PlatformSettingsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('PlatformSettingsService', () => {
  describe('reheating modes (Recettes §4.6)', () => {
    it('lists the default modes until an admin changes them', async () => {
      const { modes, updatedAt } = await harness().service.reheatModes();

      expect(modes[0]).toEqual({ code: 'oven', label: 'Four' });
      expect(updatedAt).toBeNull();
    });

    it('reads the saved list, and the defaults when what is saved is not a list', async () => {
      const grill = [{ code: 'grill', label: 'Gril' }];

      expect((await harness(grill).service.reheatModes()).modes).toEqual(grill);
      expect((await harness({ broken: true }).service.reheatModes()).modes[0].code).toBe(
        'oven',
      );
    });

    it('saves the list and journals before and after', async () => {
      const { service, prisma, audit } = harness();
      const modes = [
        { code: 'oven', label: 'Four' },
        { code: 'grill', label: 'Gril' },
      ];

      expect(await service.setReheatModes(modes, 'admin-1', 'req-1')).toEqual({
        modes,
        updatedAt: UPDATED_AT,
      });
      expect(prisma.platformSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'reheat_modes' },
          update: { value: modes, updatedByUserId: 'admin-1' },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'settings.reheat_modes_changed' }),
      );
    });

    it('lists the recipe profiles of the PRD until an admin changes them', async () => {
      const { profiles } = await harness().service.recipeProfiles();

      expect(profiles.map((p) => p.code)).toEqual([
        'kids',
        'post-partum',
        'sport',
        'budget',
        'high-protein',
      ]);
    });

    it('refuses the same code twice', async () => {
      const { service, prisma } = harness();

      await expect(
        service.setReheatModes(
          [
            { code: 'oven', label: 'Four' },
            { code: 'oven', label: 'Four à chaleur tournante' },
          ],
          'admin-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
      expect(prisma.platformSetting.upsert).not.toHaveBeenCalled();
    });
  });

  describe('chef tiers (Recettes R34)', () => {
    it('names the four tiers neutrally until an admin renames them', async () => {
      const { service } = harness();

      expect(await service.chefTiers()).toMatchObject({
        labels: {
          tier_1: 'Palier 1',
          tier_2: 'Palier 2',
          tier_3: 'Palier 3',
          tier_4: 'Palier 4',
        },
        updatedAt: null,
      });
    });

    // BLK-26 (2026-11-10): tier 1 has every privilege at the platform commission;
    // tiers 2 to 4 are not decided and restrict nothing yet.
    it('says what each tier may do and the commission it pays', async () => {
      const { rules } = await harness().service.chefTiers();

      expect(rules.tier_1).toEqual({
        decided: true,
        commissionBps: 1500,
        capabilities: expect.arrayContaining([
          expect.objectContaining({ code: 'publish_dishes' }),
          expect.objectContaining({ code: 'receive_bookings' }),
        ]),
      });
      for (const tier of ['tier_2', 'tier_3', 'tier_4'] as const) {
        expect(rules[tier].decided).toBe(false);
        expect(rules[tier].capabilities).toEqual(rules.tier_1.capabilities);
        expect(rules[tier].commissionBps).toBe(1500);
      }
    });

    it('reads the saved labels, and falls back on the default for a missing or blank one', async () => {
      const { service } = harness({ tier_1: 'Découverte', tier_2: '  ', tier_4: 42 });

      const { labels } = await service.chefTiers();

      expect(labels).toEqual({
        tier_1: 'Découverte',
        tier_2: 'Palier 2',
        tier_3: 'Palier 3',
        tier_4: 'Palier 4',
      });
    });

    it('saves the four labels and journals before and after', async () => {
      const { prisma, audit, service } = harness();
      const labels = {
        tier_1: 'Découverte',
        tier_2: 'Confirmé',
        tier_3: 'Expert',
        tier_4: 'Partenaire',
      };

      const result = await service.setChefTiers(labels, 'admin-1', 'req-1');

      expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'chef_tiers' },
        update: { value: labels, updatedByUserId: 'admin-1' },
        create: { key: 'chef_tiers', value: labels, updatedByUserId: 'admin-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'settings.chef_tiers_changed',
          metadata: {
            from: {
              tier_1: 'Palier 1',
              tier_2: 'Palier 2',
              tier_3: 'Palier 3',
              tier_4: 'Palier 4',
            },
            to: labels,
          },
          requestId: 'req-1',
        }),
      );
      expect(result).toEqual({ labels, updatedAt: UPDATED_AT });
    });
  });
});
