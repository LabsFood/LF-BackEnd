import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { ChefContentService } from '../dishes/chef-content.service';
import { UsersService } from '../users/users.service';
import { IngredientImportService } from './ingredient-import.service';
import type { IngredientEnrichmentService } from './ingredient-enrichment.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

const FIGURES = { dishes: 2, reverified: 1, chefs: 1, skipped: 0, failed: 0 };

function harness(chefProfileId: string | null) {
  const ingredients = {
    search: jest.fn(async (..._a: unknown[]) => []),
    impact: jest.fn(async (_id: string) => ({ dishes: 3, chefs: 2, verifiedDishes: 1 })),
    propagate: jest.fn(async (_id: string, _adminId: string) => FIGURES),
    dishes: jest.fn(async (_id: string) => ({ data: [], total: 0 })),
    validate: jest.fn(async (..._a: unknown[]) => ({
      ingredient: { id: 'p-1' },
      propagation: null,
    })),
    merge: jest.fn(async (..._a: unknown[]) => ({
      ingredient: { id: 'p-1' },
      propagation: FIGURES,
    })),
  };
  const users = { findByClerkId: jest.fn(async (_id: string) => ({ id: 'admin-1' })) };
  const chefs = { chefProfileIdOf: jest.fn(async (_id: string) => chefProfileId) };
  const importer = { run: jest.fn(async (..._a: unknown[]) => ({ created: 1 })) };
  const controller = new IngredientsController(
    ingredients as unknown as IngredientsService,
    users as unknown as UsersService,
    chefs as unknown as ChefContentService,
    importer as unknown as IngredientImportService,
    {} as unknown as IngredientEnrichmentService,
  );
  return { ingredients, chefs, importer, controller };
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

describe('IngredientsController propagate (ruling R14)', () => {
  it('replays the propagation as the calling admin and answers its figures', async () => {
    const { ingredients, controller } = harness(null);
    await expect(
      controller.propagate({ userId: 'clerk-admin' } as never, 'ing-1'),
    ).resolves.toEqual(FIGURES);
    expect(ingredients.propagate).toHaveBeenCalledWith('ing-1', 'admin-1');
  });

  it('is for admins only, and takes a UUID only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, IngredientsController.prototype.propagate),
    ).toEqual([ClerkAuthGuard, AdminGuard]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      IngredientsController,
      'propagate',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const id = Object.values(args).find((arg) => arg.data === 'id');
    expect(id?.pipes).toEqual([ParseUUIDPipe]);
  });
});

describe('IngredientsController validate and merge (Recettes §7.2)', () => {
  it('validates as the calling admin and answers the entry with its propagation', async () => {
    const { ingredients, controller } = harness(null);
    await expect(
      controller.validate({ userId: 'clerk-admin' } as never, 'p-1'),
    ).resolves.toEqual({ ingredient: { id: 'p-1' }, propagation: null });
    expect(ingredients.validate).toHaveBeenCalledWith('p-1', 'admin-1');
  });

  it('merges as the calling admin into the target of the body', async () => {
    const { ingredients, controller } = harness(null);
    await expect(
      controller.merge({ userId: 'clerk-admin' } as never, 'p-1', { intoId: 'ing-1' }),
    ).resolves.toEqual({ ingredient: { id: 'p-1' }, propagation: FIGURES });
    expect(ingredients.merge).toHaveBeenCalledWith('p-1', 'ing-1', 'admin-1');
  });

  it.each(['validate', 'merge'] as const)(
    '%s is for admins only, and takes a UUID only',
    (route) => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, IngredientsController.prototype[route]),
      ).toEqual([ClerkAuthGuard, AdminGuard]);
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        IngredientsController,
        route,
      ) as Record<string, { data?: string; pipes: unknown[] }>;
      const id = Object.values(args).find((arg) => arg.data === 'id');
      expect(id?.pipes).toEqual([ParseUUIDPipe]);
    },
  );
});

describe('IngredientsController import (Recettes §7.4)', () => {
  it('simulates by default and passes the admin id', async () => {
    const { importer, controller } = harness(null);
    await controller.import({ userId: 'clerk-1' } as never, { csv: 'x' });
    expect(importer.run).toHaveBeenCalledWith('x', { confirm: false }, 'admin-1');
  });

  it('writes with confirm: true, behind the admin guards', async () => {
    const { importer, controller } = harness(null);
    await controller.import({ userId: 'clerk-1' } as never, { csv: 'x', confirm: true });
    expect(importer.run).toHaveBeenCalledWith('x', { confirm: true }, 'admin-1');
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      IngredientsController.prototype.import,
    );
    expect(guards).toEqual([ClerkAuthGuard, AdminGuard]);
  });
});

describe('IngredientsController dishes (ruling R25)', () => {
  it('answers the dishes of the service', async () => {
    const { ingredients, controller } = harness(null);
    await expect(controller.dishes('ing-1')).resolves.toEqual({ data: [], total: 0 });
    expect(ingredients.dishes).toHaveBeenCalledWith('ing-1');
  });

  it('is for admins only, and takes a UUID only', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, IngredientsController.prototype.dishes),
    ).toEqual([ClerkAuthGuard, AdminGuard]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      IngredientsController,
      'dishes',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const id = Object.values(args).find((arg) => arg.data === 'id');
    expect(id?.pipes).toEqual([ParseUUIDPipe]);
  });
});
