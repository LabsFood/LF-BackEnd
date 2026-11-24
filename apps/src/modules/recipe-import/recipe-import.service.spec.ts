import {
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AiGateway } from '../ai/ai-gateway.service';
import { aiBudgetReached } from '../ai/ai.errors';
import type { ChefContentService } from '../dishes/chef-content.service';
import type { DishesService } from '../dishes/dishes.service';
import type { Extraction, ExtractedRecipe } from './extraction/schema';
import type { RecipeImportStorageService } from './recipe-import-storage.service';
import { RecipeImportService } from './recipe-import.service';

const CHEF = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const recipe = (name: string, over: Partial<ExtractedRecipe> = {}): ExtractedRecipe => ({
  name,
  description: null,
  portions: 4,
  portionsNote: null,
  prepMinutes: 20,
  cookMinutes: 30,
  difficulty: null,
  category: null,
  country: 'FR',
  ingredients: [
    {
      rawText: '2 oignons',
      qty: 2,
      unit: 'piece',
      name: 'oignon',
      preparation: null,
      optional: false,
      group: null,
      certain: true,
    },
  ],
  steps: [{ text: 'Cuire', type: 'cuisson', durationMinutes: 30 }],
  storageDays: null,
  freezable: null,
  storageContainer: null,
  reheatingModes: [],
  reheatingMinutes: null,
  reheatingTemperature: null,
  reheatingContainer: null,
  reheatingNote: null,
  equipment: [],
  suspectedAllergens: ['celery'],
  estimatedFields: [],
  warnings: [],
  ...over,
});

function setup(
  opts: {
    extraction?: Extraction;
    gatewayError?: Error;
    settings?: unknown;
    counts?: [number, number];
    existing?: { id: string; name: string }[];
  } = {},
) {
  const rows = new Map<string, Record<string, unknown>>();
  const withMeals = (r: Record<string, unknown> | undefined) =>
    r ? { meals: [], report: {}, ...r } : null;
  const counts = [...(opts.counts ?? [0, 0])];
  const prisma = {
    platformSetting: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          value: opts.settings ?? { mode: 'beta', betaChefProfileIds: [CHEF] },
        }),
      ),
    },
    recipeImport: {
      count: jest.fn(() => Promise.resolve(counts.shift() ?? 0)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'imp-1',
          status: 'pending',
          storagePaths: [],
          createdAt: new Date(),
          chefProfileId: null,
          createdByUserId: null,
          ...data,
        };
        rows.set('imp-1', row);
        return Promise.resolve(withMeals(row));
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: { id: string; status: string }; data: object }) => {
          const row = rows.get(where.id);
          if (!row || row.status !== where.status) return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.get(where.id)!;
          for (const [k, v] of Object.entries(data)) {
            row[k] =
              typeof v === 'object' && v && 'increment' in v
                ? Number(row[k] ?? 0) + (v as { increment: number }).increment
                : v;
          }
          return Promise.resolve(row);
        },
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(withMeals(rows.get(where.id))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const row = rows.get(where.id as string);
        const matches =
          row &&
          Object.entries(where).every(([k, v]) => k === 'id' || (row[k] ?? null) === v);
        return Promise.resolve(matches ? withMeals(row) : null);
      }),
    },
    catalogIngredient: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { id: '0c7b2a0e-1b6f-4b0e-8f3a-1d2c3b4a5f6e', name: 'Oignon', aliases: [] },
        ]),
      ),
    },
    meal: {
      findMany: jest.fn(() => Promise.resolve(opts.existing ?? [])),
      update: jest.fn(() => Promise.resolve({})),
    },
  };
  const gateway = {
    run: jest.fn(() =>
      opts.gatewayError
        ? Promise.reject(opts.gatewayError)
        : Promise.resolve({
            data: opts.extraction ?? {
              recipes: [recipe('Poulet basquaise')],
              warnings: [],
            },
            provider: 'mistral',
            model: 'mistral-small-latest',
            attempt: 1,
            belowThreshold: false,
            costMicroEur: 1200,
          }),
    ),
  };
  const storage = {
    pathOf: jest.fn((c: string, u: string) => `${c}/${u}`),
    read: jest.fn(),
  };
  const access = {
    chef: jest.fn((clerk: string) =>
      Promise.resolve({ id: clerk === 'other' ? OTHER : CHEF, isVerified: true }),
    ),
    assertVerified: jest.fn(),
  };
  const dishes = {
    create: jest.fn(() => Promise.resolve({ id: 'meal-1', allergens: [] })),
  };
  const service = new RecipeImportService(
    prisma as unknown as PrismaService,
    gateway as unknown as AiGateway,
    storage as unknown as RecipeImportStorageService,
    access as unknown as ChefContentService,
    dishes as unknown as DishesService,
  );
  jest
    .spyOn(global, 'setImmediate')
    .mockImplementation((() => 0) as unknown as typeof setImmediate);
  return { service, rows, prisma, gateway, dishes };
}

describe('RecipeImportService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('crée un import en attente puis un brouillon relié, allergènes en écart signalés', async () => {
    const { service, rows, gateway, dishes, prisma } = setup();
    const created = await service.create('clerk', {
      sourceType: 'text',
      text: 'Poulet basquaise pour 4 personnes...',
    });
    expect(created.status).toBe('pending');
    await service.process('imp-1', 'clerk');
    expect(gateway.run).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { poste: 'recettes', feature: 'import_recette', tags: ['source:text'] },
        chefProfileId: CHEF,
        routes: [{ provider: 'mistral', model: 'mistral-small-latest' }],
      }),
    );
    expect(dishes.create).toHaveBeenCalledWith(
      'clerk',
      expect.objectContaining({
        name: 'Poulet basquaise',
        recipe: expect.objectContaining({
          ingredients: [
            expect.objectContaining({
              catalogIngredientId: '0c7b2a0e-1b6f-4b0e-8f3a-1d2c3b4a5f6e',
              toVerify: false,
            }),
          ],
        }),
      }),
    );
    expect(prisma.meal.update).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: { importedFromId: 'imp-1' },
    });
    const row = rows.get('imp-1')!;
    expect(row).toMatchObject({
      status: 'done',
      costMicroEur: 1200,
      provider: 'mistral',
    });
    expect(row.report).toMatchObject({
      allergenGaps: ['celery'],
      linked: 1,
      toVerify: 0,
    });
  });

  it('demande un choix quand plusieurs recettes sont lues, puis crée celle choisie', async () => {
    const { service, rows, dishes } = setup({
      extraction: { recipes: [recipe('Tarte'), recipe('Quiche')], warnings: [] },
    });
    await service.create('clerk', { sourceType: 'title', title: 'Tarte' });
    await service.process('imp-1', 'clerk');
    expect(rows.get('imp-1')).toMatchObject({ status: 'review' });
    const chefView = await service.get('clerk', 'imp-1');
    expect(chefView.candidates.map((c) => c.name)).toEqual(['Tarte', 'Quiche']);
    expect(chefView.trace).toMatchObject({ provider: 'mistral', belowThreshold: false });
    await service.choose('clerk', 'imp-1', [1]);
    expect(dishes.create).toHaveBeenCalledWith(
      'clerk',
      expect.objectContaining({ name: 'Quiche' }),
    );
    expect(rows.get('imp-1')?.status).toBe('done');
  });

  it('crée un brouillon par recette cochée, avec ce qu’il faut relire plat par plat', async () => {
    const { service, rows, dishes } = setup({
      extraction: {
        recipes: [recipe('Tarte'), recipe('Quiche'), recipe('Flan')],
        warnings: [],
      },
    });
    let n = 0;
    dishes.create.mockImplementation(() =>
      Promise.resolve({ id: `meal-${++n}`, allergens: [] }),
    );
    await service.create('clerk', { sourceType: 'title', title: 'Tarte' });
    await service.process('imp-1', 'clerk');
    await service.choose('clerk', 'imp-1', [2, 0, 2]);
    expect(dishes.create).toHaveBeenCalledTimes(2);
    expect(dishes.create).toHaveBeenNthCalledWith(
      1,
      'clerk',
      expect.objectContaining({ name: 'Flan' }),
    );
    expect(dishes.create).toHaveBeenNthCalledWith(
      2,
      'clerk',
      expect.objectContaining({ name: 'Tarte' }),
    );
    const report = rows.get('imp-1')?.report as {
      perMeal: Record<string, { linked: number }>;
      linked: number;
    };
    expect(rows.get('imp-1')?.status).toBe('done');
    expect(Object.keys(report.perMeal)).toEqual(['meal-1', 'meal-2']);
    expect(report.linked).toBe(
      report.perMeal['meal-1'].linked + report.perMeal['meal-2'].linked,
    );
  });

  it('refuse un choix vide ou hors liste', async () => {
    const { service } = setup({
      extraction: { recipes: [recipe('Tarte'), recipe('Quiche')], warnings: [] },
    });
    await service.create('clerk', { sourceType: 'title', title: 'Tarte' });
    await service.process('imp-1', 'clerk');
    await expect(service.choose('clerk', 'imp-1', [])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.choose('clerk', 'imp-1', [0, 5])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('signale un doublon avant de créer', async () => {
    const { service, rows, dishes } = setup({
      existing: [{ id: 'm0', name: 'POULET basquaise' }],
    });
    await service.create('clerk', {
      sourceType: 'text',
      text: 'Poulet basquaise pour 4 personnes...',
    });
    await service.process('imp-1', 'clerk');
    expect(rows.get('imp-1')).toMatchObject({
      status: 'review',
      report: expect.objectContaining({
        duplicateOf: { id: 'm0', name: 'POULET basquaise' },
      }),
    });
    expect(dishes.create).not.toHaveBeenCalled();
  });

  it('écrit un échec lisible quand le budget IA est atteint', async () => {
    const { service, rows } = setup({
      gatewayError: aiBudgetReached('recettes', 'month'),
    });
    await service.create('clerk', {
      sourceType: 'text',
      text: 'Poulet basquaise pour 4 personnes...',
    });
    await service.process('imp-1', 'clerk');
    expect(rows.get('imp-1')).toMatchObject({
      status: 'failed',
      errorCode: 'AI_BUDGET_REACHED',
    });
    expect(String(rows.get('imp-1')?.errorMessage)).toContain('budget IA');
  });

  it('retire un champ facultatif refusé plutôt que de perdre l’import', async () => {
    const { service, dishes } = setup({
      extraction: { recipes: [recipe('Tajine', { country: 'XX' })], warnings: [] },
    });
    await service.create('clerk', {
      sourceType: 'text',
      text: 'Tajine aux légumes pour quatre...',
    });
    await service.process('imp-1', 'clerk');
    const payload = (dishes.create.mock.calls[0] as unknown[])[1] as { country?: string };
    expect(payload.country).toBeUndefined();
  });

  it('refuse quand l’import est fermé à ce cuisinier, et au-delà des quotas', async () => {
    const closed = setup({ settings: { mode: 'off' } });
    await expect(
      closed.service.create('clerk', { sourceType: 'title', title: 'Tarte' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_FEATURE_CLOSED' }),
    });
    const busy = setup({ counts: [0, 3] });
    const error = await busy.service
      .create('clerk', { sourceType: 'title', title: 'Tarte' })
      .catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('ne montre pas l’import d’un autre cuisinier', async () => {
    const { service } = setup();
    await service.create('clerk', { sourceType: 'title', title: 'Tarte' });
    await expect(service.get('other', 'imp-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse un dépôt hors du dossier du cuisinier', async () => {
    const { service } = setup();
    const s = service as unknown as { storage: { pathOf: jest.Mock } };
    s.storage.pathOf.mockReturnValueOnce(null);
    await expect(
      service.create('clerk', { sourceType: 'file', uploadIds: ['ri_x'] }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    });
  });

  describe('import de la console', () => {
    const ADMIN = '33333333-3333-4333-8333-333333333333';

    it('lit les recettes sans créer de plat et rend un brouillon par recette', async () => {
      const { service, rows, gateway, dishes, prisma } = setup({
        settings: { mode: 'off', betaChefProfileIds: [] },
        extraction: {
          recipes: [recipe('Poulet basquaise'), recipe('Riz pilaf')],
          warnings: [],
        },
      });
      const created = await service.adminCreate(ADMIN, {
        sourceType: 'text',
        text: 'Poulet basquaise et riz pilaf pour 4 personnes...',
      });
      expect(created.status).toBe('pending');
      expect(rows.get('imp-1')).toMatchObject({ createdByUserId: ADMIN });
      expect(rows.get('imp-1')?.chefProfileId ?? null).toBeNull();
      await service.process('imp-1', '');
      expect(gateway.run).toHaveBeenCalledWith(
        expect.objectContaining({ chefProfileId: null }),
      );
      expect(dishes.create).not.toHaveBeenCalled();
      expect(prisma.catalogIngredient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ chefProfileId: null, status: 'active' }] },
        }),
      );
      const view = await service.adminGet(ADMIN, 'imp-1');
      expect(view.status).toBe('done');
      expect(view.trace).toMatchObject({
        provider: 'mistral',
        model: 'mistral-small-latest',
        belowThreshold: false,
      });
      expect(view.drafts.map((d) => d.dish.name)).toEqual([
        'Poulet basquaise',
        'Riz pilaf',
      ]);
      expect(view.drafts[0]).toMatchObject({
        suspectedAllergens: ['celery'],
        linked: 1,
        dish: {
          recipe: {
            ingredients: [
              expect.objectContaining({
                catalogIngredientId: '0c7b2a0e-1b6f-4b0e-8f3a-1d2c3b4a5f6e',
              }),
            ],
          },
        },
      });
    });

    it("compte le quota par admin et cache l'import aux autres", async () => {
      const { service, prisma } = setup({ counts: [30, 0] });
      await expect(
        service.adminCreate(ADMIN, { sourceType: 'title', title: 'Mafé' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.recipeImport.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdByUserId: ADMIN }),
        }),
      );
      const other = setup();
      await other.service.adminCreate(ADMIN, { sourceType: 'title', title: 'Mafé' });
      await expect(
        other.service.adminGet('someone-else', 'imp-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(other.service.get('clerk', 'imp-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
