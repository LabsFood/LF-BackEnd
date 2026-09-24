import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  MealContinent,
  MealDifficulty,
  MealStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const ADMIN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/** Legacy admin writes only ever match an unowned (Lab's Food) row. */
const LABS_FOOD_MEAL_1 = { id: 'meal-1', chefProfileId: null };

const knownRequestError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });

describe('CatalogService', () => {
  let service: CatalogService;
  let meal: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let menuWeek: { findFirst: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    meal = {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (args: unknown) => args),
      update: jest.fn(async (args: unknown) => args),
      delete: jest.fn(async () => undefined),
    };
    menuWeek = {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: unknown) => args),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: { meal, menuWeek } },
      ],
    }).compile();

    service = moduleRef.get(CatalogService);
  });

  describe('createMeal', () => {
    it('persists imageUrl and the full metadata set', async () => {
      await service.createMeal(
        {
          name: 'Poulet yassa',
          prepTime: 45,
          imageUrl: 'https://cdn.example.com/meals/yassa.jpg',
          continent: MealContinent.africa,
          country: 'Sénégal',
          portions: 6,
          calories: 620,
          difficulty: MealDifficulty.medium,
          steps: ['Marinate', 'Sear'],
          isFeatured: true,
          status: MealStatus.published,
        },
        ADMIN_ID,
      );

      expect(meal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Poulet yassa',
          imageUrl: 'https://cdn.example.com/meals/yassa.jpg',
          continent: MealContinent.africa,
          country: 'Sénégal',
          portions: 6,
          calories: 620,
          difficulty: MealDifficulty.medium,
          steps: ['Marinate', 'Sear'],
          isFeatured: true,
          status: MealStatus.published,
        }),
      });
    });

    it('stores null for an omitted imageUrl and defaults status to draft', async () => {
      await service.createMeal({ name: 'Thieboudienne', prepTime: 60 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.imageUrl).toBeNull();
      expect(data.status).toBe(MealStatus.draft);
    });

    it('leaves columns with schema defaults undefined when omitted', async () => {
      await service.createMeal({ name: 'Mafé', prepTime: 90 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.portions).toBeUndefined();
      expect(data.steps).toBeUndefined();
      expect(data.isFeatured).toBeUndefined();
    });

    it('records the admin as author and never sets an owner', async () => {
      await service.createMeal({ name: 'Mafé', prepTime: 90 }, ADMIN_ID);

      const { data } = meal.create.mock.calls[0][0];
      expect(data.createdByUserId).toBe(ADMIN_ID);
      expect(data).not.toHaveProperty('chefProfileId');
    });
  });

  describe('listMeals', () => {
    it("lists Lab's Food meals only", async () => {
      await service.listMeals();

      expect(meal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chefProfileId: null } }),
      );
    });
  });

  describe('updateMeal', () => {
    it('passes null through for nullable columns so they can be cleared', async () => {
      await service.updateMeal('meal-1', { imageUrl: null, calories: null });

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { imageUrl: null, calories: null },
      });
    });

    it('ignores null on non-nullable columns instead of forwarding it to Prisma', async () => {
      await service.updateMeal('meal-1', {
        portions: null as never,
        status: null as never,
        name: 'Renamed',
      });

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { name: 'Renamed' },
      });
    });

    it('omits untouched fields from the update payload', async () => {
      await service.updateMeal('meal-1', {
        imageUrl: 'https://cdn.example.com/meals/new.jpg',
      });

      expect(meal.update).toHaveBeenCalledWith({
        where: LABS_FOOD_MEAL_1,
        data: { imageUrl: 'https://cdn.example.com/meals/new.jpg' },
      });
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.update.mockRejectedValueOnce(knownRequestError('P2025'));
      meal.findUnique.mockResolvedValueOnce({ chefProfileId: 'chef-1' });

      const error = await service
        .updateMeal('meal-1', { name: 'Taken over' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'CONTENT_NOT_OWNED',
      });
    });

    it('answers 404 for an unknown id', async () => {
      meal.update.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(service.updateMeal('missing', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deleteMeal', () => {
    it('deletes the meal', async () => {
      await service.deleteMeal('meal-1');

      expect(meal.delete).toHaveBeenCalledWith({ where: LABS_FOOD_MEAL_1 });
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2025'));
      meal.findUnique.mockResolvedValueOnce({ chefProfileId: 'chef-1' });

      await expect(service.deleteMeal('meal-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps a missing record (P2025) to NotFoundException', async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2025'));

      await expect(service.deleteMeal('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps a booking reference (P2003) to ConflictException', async () => {
      meal.delete.mockRejectedValueOnce(knownRequestError('P2003'));

      await expect(service.deleteMeal('meal-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows unexpected errors untouched', async () => {
      const failure = new Error('connection lost');
      meal.delete.mockRejectedValueOnce(failure);

      await expect(service.deleteMeal('meal-1')).rejects.toBe(failure);
    });
  });

  describe('createMenuWeek', () => {
    it("puts Lab's Food meals on the menu, each once", async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-1', chefProfileId: null }]);

      await service.createMenuWeek({
        year: 2026,
        weekNumber: 40,
        mealIds: ['meal-1', 'meal-1'],
      });

      const { data } = menuWeek.create.mock.calls[0][0];
      expect(data.meals.create).toEqual([{ meal: { connect: { id: 'meal-1' } } }]);
    });

    it("refuses a chef's dish with 403 CONTENT_NOT_OWNED", async () => {
      meal.findMany.mockResolvedValueOnce([{ id: 'meal-1', chefProfileId: 'chef-1' }]);

      await expect(
        service.createMenuWeek({ year: 2026, weekNumber: 40, mealIds: ['meal-1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(menuWeek.create).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown meal id instead of a server error', async () => {
      meal.findMany.mockResolvedValueOnce([]);

      await expect(
        service.createMenuWeek({ year: 2026, weekNumber: 40, mealIds: ['missing'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getCurrentPublishedMenu', () => {
    it("serves Lab's Food meals only, without their recipe", async () => {
      await service.getCurrentPublishedMenu();

      const { include } = menuWeek.findFirst.mock.calls[0][0];
      expect(include.meals).toEqual({
        where: { meal: { chefProfileId: null } },
        include: { meal: { omit: { ingredients: true, steps: true } } },
      });
    });
  });
});
