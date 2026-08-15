import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  MealContinent,
  MealDifficulty,
  MealStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const knownRequestError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });

describe('CatalogService', () => {
  let service: CatalogService;
  let meal: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    meal = {
      findMany: jest.fn(),
      create: jest.fn(async (args: unknown) => args),
      update: jest.fn(async (args: unknown) => args),
      delete: jest.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [CatalogService, { provide: PrismaService, useValue: { meal } }],
    }).compile();

    service = moduleRef.get(CatalogService);
  });

  describe('createMeal', () => {
    it('persists imageUrl and the full metadata set', async () => {
      await service.createMeal({
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
      });

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
      await service.createMeal({ name: 'Thieboudienne', prepTime: 60 });

      const { data } = meal.create.mock.calls[0][0];
      expect(data.imageUrl).toBeNull();
      expect(data.status).toBe(MealStatus.draft);
    });

    it('leaves columns with schema defaults undefined when omitted', async () => {
      await service.createMeal({ name: 'Mafé', prepTime: 90 });

      const { data } = meal.create.mock.calls[0][0];
      expect(data.portions).toBeUndefined();
      expect(data.steps).toBeUndefined();
      expect(data.isFeatured).toBeUndefined();
    });
  });

  describe('updateMeal', () => {
    it('passes null through for nullable columns so they can be cleared', async () => {
      await service.updateMeal('meal-1', { imageUrl: null, calories: null });

      expect(meal.update).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
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
        where: { id: 'meal-1' },
        data: { name: 'Renamed' },
      });
    });

    it('omits untouched fields from the update payload', async () => {
      await service.updateMeal('meal-1', {
        imageUrl: 'https://cdn.example.com/meals/new.jpg',
      });

      expect(meal.update).toHaveBeenCalledWith({
        where: { id: 'meal-1' },
        data: { imageUrl: 'https://cdn.example.com/meals/new.jpg' },
      });
    });
  });

  describe('deleteMeal', () => {
    it('deletes the meal', async () => {
      await service.deleteMeal('meal-1');

      expect(meal.delete).toHaveBeenCalledWith({ where: { id: 'meal-1' } });
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
});
