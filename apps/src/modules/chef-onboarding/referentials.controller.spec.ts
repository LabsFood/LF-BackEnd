import { NotFoundException } from '@nestjs/common';

import { GeoService } from '../../integrations/geo.service';
import { ReferentialsController } from './referentials.controller';

const labels = (rows: readonly { label: string }[]) => rows.map((r) => r.label);
const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, 'fr'));

describe('ReferentialsController: lists a dropdown shows', () => {
  const communesByRegion = jest.fn();
  const controller = new ReferentialsController({
    communesByRegion,
  } as unknown as GeoService);

  beforeEach(() => communesByRegion.mockReset());

  it('serves the regions in alphabetical order, Île-de-France under I', () => {
    const out = labels(controller.regions().regions);
    expect(out).toEqual(sorted(out));
    expect(out.indexOf('Île-de-France')).toBeGreaterThan(out.indexOf('Hauts-de-France'));
    expect(out.indexOf('Île-de-France')).toBeLessThan(out.indexOf('Normandie'));
  });

  it('serves every ISO 639-1 language, alphabetically, each with a French name', () => {
    const { languages } = controller.languages();
    const out = labels(languages);
    expect(out).toEqual(sorted(out));
    expect(languages.length).toBeGreaterThanOrEqual(180);
    // A code ICU cannot name comes back as itself: never ship that to a dropdown.
    expect(languages.filter((l) => l.label.toLowerCase() === l.code)).toEqual([]);
    expect(languages.find((l) => l.code === 'fr')?.label).toBe('Français');
    expect(languages.find((l) => l.code === 'wo')?.label).toBe('Wolof');
  });

  it('keeps every code a batch cooker already saved', () => {
    const codes = controller.languages().languages.map((l) => l.code);
    for (const saved of ['fr', 'en', 'es', 'ar', 'zh', 'wo', 'ln', 'bm', 'ff', 'sw']) {
      expect(codes).toContain(saved);
    }
  });

  describe('communes of a region', () => {
    const upstream = [
      { nom: 'Étampes', code: '91223', codeDepartement: '91' },
      { nom: 'Évry-Courcouronnes', code: '91228', codeDepartement: '91' },
      { nom: 'Arpajon', code: '91021', codeDepartement: '91' },
      { nom: 'Paris', code: '75056', codeDepartement: '75' },
    ];

    it('lists them all, alphabetically, shaped like an intervention-zone city', async () => {
      communesByRegion.mockResolvedValue(upstream);

      const { communes } = await controller.communes('11');

      expect(communes.map((c) => c.name)).toEqual([
        'Arpajon',
        'Étampes',
        'Évry-Courcouronnes',
        'Paris',
      ]);
      expect(communes[0]).toEqual({ name: 'Arpajon', insee: '91021', department: '91' });
    });

    it('refuses a region that is not metropolitan, without calling upstream', async () => {
      await expect(controller.communes('01')).rejects.toBeInstanceOf(NotFoundException);
      expect(communesByRegion).not.toHaveBeenCalled();
    });

    it('asks upstream once per region, not once per visitor', async () => {
      communesByRegion.mockResolvedValue(upstream);

      await controller.communes('93');
      await controller.communes('93');

      expect(communesByRegion).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failure', async () => {
      communesByRegion
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue(upstream);

      await expect(controller.communes('84')).rejects.toThrow('down');
      await expect(controller.communes('84')).resolves.toHaveProperty('communes');
    });
  });
});
