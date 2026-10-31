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
  describe('chef tiers (Recettes R34)', () => {
    it('names the four tiers neutrally until an admin renames them', async () => {
      const { service } = harness();

      expect(await service.chefTiers()).toEqual({
        labels: {
          tier_1: 'Palier 1',
          tier_2: 'Palier 2',
          tier_3: 'Palier 3',
          tier_4: 'Palier 4',
        },
        updatedAt: null,
      });
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
