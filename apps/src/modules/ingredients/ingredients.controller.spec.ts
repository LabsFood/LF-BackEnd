import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { ChefContentService } from '../dishes/chef-content.service';
import { UsersService } from '../users/users.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

function harness(chefProfileId: string | null) {
  const ingredients = {
    search: jest.fn(async (..._a: unknown[]) => []),
    impact: jest.fn(async (_id: string) => ({ dishes: 3, chefs: 2, verifiedDishes: 1 })),
  };
  const chefs = { chefProfileIdOf: jest.fn(async (_id: string) => chefProfileId) };
  const controller = new IngredientsController(
    ingredients as unknown as IngredientsService,
    {} as UsersService,
    chefs as unknown as ChefContentService,
  );
  return { ingredients, chefs, controller };
}

describe('IngredientsController search (Recettes §4.10)', () => {
  it('searches with the caller’s chef profile', async () => {
    const { ingredients, chefs, controller } = harness('chef-1');
    await controller.search({ userId: 'clerk-1' } as never, { search: 'tom' });
    expect(chefs.chefProfileIdOf).toHaveBeenCalledWith('clerk-1');
    expect(ingredients.search).toHaveBeenCalledWith('tom', 'chef-1');
  });

  it('an admin without a chef profile searches with null', async () => {
    const { ingredients, controller } = harness(null);
    await controller.search({ userId: 'clerk-2' } as never, { search: 'tom' });
    expect(ingredients.search).toHaveBeenCalledWith('tom', null);
  });
});

describe('IngredientsController impact (Recettes §7.2)', () => {
  it('answers the counts of the service', async () => {
    const { ingredients, controller } = harness(null);
    await expect(controller.impact('ing-1')).resolves.toEqual({
      dishes: 3,
      chefs: 2,
      verifiedDishes: 1,
    });
    expect(ingredients.impact).toHaveBeenCalledWith('ing-1');
  });

  it('is for admins only, and takes a UUID only', () => {
    const route = IngredientsController.prototype.impact;
    expect(Reflect.getMetadata(GUARDS_METADATA, route)).toEqual([
      ClerkAuthGuard,
      AdminGuard,
    ]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      IngredientsController,
      'impact',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const id = Object.values(args).find((arg) => arg.data === 'id');
    expect(id?.pipes).toEqual([ParseUUIDPipe]);
  });

  it('refuses an id that is not a UUID', async () => {
    await expect(
      new ParseUUIDPipe().transform('1 OR 1=1', { type: 'param', data: 'id' }),
    ).rejects.toThrow();
  });
});
