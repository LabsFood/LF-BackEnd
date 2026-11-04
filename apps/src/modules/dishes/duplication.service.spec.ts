import { NotFoundException } from '@nestjs/common';

import { MealStatus } from '../../generated/prisma/client';
import { R2StorageService } from '../../integrations/r2-storage.service';
import { CHEF, dishRow, harness, menuRow, readyDishRow } from './dishes.test-helpers';
import { DuplicationService } from './duplication.service';

const PUBLIC = 'https://photos.example.com';

function service(h: ReturnType<typeof harness>) {
  const storage = {
    keyOf: jest.fn((url: string | null) =>
      url?.startsWith(`${PUBLIC}/`) ? url.slice(PUBLIC.length + 1) : null,
    ),
    publicUrl: jest.fn((key: string) => `${PUBLIC}/${key}`),
    copy: jest.fn(async (_from: string, _to: string) => true),
  };
  return {
    storage,
    duplication: new DuplicationService(
      h.prisma,
      h.access,
      storage as unknown as R2StorageService,
    ),
  };
}

describe('DuplicationService (Recettes §5.4)', () => {
  it('copies a dish as a draft "(copie)", a variant of it, with nothing verified or versioned', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(
      readyDishRow({
        status: MealStatus.published,
        sourceMealId: 'suggestion-1',
        recipeVersion: 4,
        imageUrl: null,
        allergens: ['celery'],
        allergensNone: false,
      }),
    );
    h.meal.create.mockImplementation(async ({ data }: { data: object }) =>
      dishRow({ ...data, id: 'copy-1' }),
    );

    await service(h).duplication.dish('clerk_1', 'dish-1');

    const { data } = h.meal.create.mock.calls[0][0];
    expect(data).toMatchObject({
      chefProfileId: CHEF.id,
      createdByUserId: CHEF.userId,
      name: 'Poulet rôti aux herbes (copie)',
      status: MealStatus.draft,
      variantOfId: 'dish-1',
      versionPending: true,
      allergens: ['celery'],
    });
    // LF-0241: the chef verifies the copy's allergens again.
    expect(data.allergensVerifiedAt).toBeUndefined();
    // Never the adoption link: its unique index allows one copy of a suggestion.
    expect(data.sourceMealId).toBeUndefined();
    expect(data.recipeVersion).toBeUndefined();
  });

  it('gives the copy its own photo file, so removing one never removes the other', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(
      dishRow({ imageUrl: `${PUBLIC}/chefs/chef-1/dishes/dish-1/ph_a.jpg` }),
    );
    h.meal.create.mockImplementation(async ({ data }: { data: object }) =>
      dishRow({ ...data, id: 'copy-1' }),
    );
    const { duplication, storage } = service(h);

    await duplication.dish('clerk_1', 'dish-1');

    expect(storage.copy).toHaveBeenCalledWith(
      'chefs/chef-1/dishes/dish-1/ph_a.jpg',
      'chefs/chef-1/dishes/copy-1/ph_a.jpg',
    );
    expect(h.meal.update).toHaveBeenCalledWith({
      where: { id: 'copy-1' },
      data: { imageUrl: `${PUBLIC}/chefs/chef-1/dishes/copy-1/ph_a.jpg` },
    });
  });

  it('keeps the copy without a photo when the file cannot be copied', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(
      dishRow({ imageUrl: `${PUBLIC}/chefs/chef-1/dishes/dish-1/ph_a.jpg` }),
    );
    const { duplication, storage } = service(h);
    storage.copy.mockResolvedValue(false);

    await duplication.dish('clerk_1', 'dish-1');

    expect(h.meal.create.mock.calls[0][0].data.imageUrl).toBeUndefined();
    expect(h.meal.update).not.toHaveBeenCalled();
  });

  it('shortens a long name so "(copie)" still fits', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(dishRow({ name: 'x'.repeat(255) }));

    await service(h).duplication.dish('clerk_1', 'dish-1');

    const { name } = h.meal.create.mock.calls[0][0].data as { name: string };
    expect(name).toHaveLength(255);
    expect(name.endsWith(' (copie)')).toBe(true);
  });

  it('copies a menu as a draft with the same dishes, in order, no dish copied', async () => {
    const h = harness();
    h.menu.findUnique.mockResolvedValue(
      menuRow({ status: MealStatus.published }, [
        dishRow({ id: 'd1' }),
        dishRow({ id: 'd2' }),
      ]),
    );

    await service(h).duplication.menu('clerk_1', 'menu-1');

    const { data } = h.menu.create.mock.calls[0][0];
    expect(data).toMatchObject({
      chefProfileId: CHEF.id,
      title: 'Semaine méditerranéenne (copie)',
      status: MealStatus.draft,
      dishes: {
        create: [
          { mealId: 'd1', position: 0 },
          { mealId: 'd2', position: 1 },
        ],
      },
    });
    expect(h.meal.create).not.toHaveBeenCalled();
  });

  it('copies nothing of another chef', async () => {
    const h = harness();
    h.meal.findUnique.mockResolvedValue(dishRow({ chefProfileId: 'chef-2' }));

    await expect(service(h).duplication.dish('clerk_1', 'dish-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.meal.create).not.toHaveBeenCalled();
  });
});
