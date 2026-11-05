import { ChefContentService } from '../dishes/chef-content.service';
import { UsersService } from '../users/users.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

function harness(chefProfileId: string | null) {
  const ingredients = { search: jest.fn(async (..._a: unknown[]) => []) };
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
