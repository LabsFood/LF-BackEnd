import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

interface AggregatedItem {
  aisle: string;
  name: string;
  quantity: string;
}

@Injectable()
export class ShoppingListsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByBookingId(bookingId: string) {
    return this.prisma.shoppingList.findUnique({
      where: { bookingId },
      include: { items: { orderBy: [{ aisle: 'asc' }, { name: 'asc' }] } },
    });
  }

  async regenerateForBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        bookingMeals: {
          include: { meal: true },
        },
      },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    const items = this.aggregateBookingIngredients(booking.bookingMeals);
    const shoppingList = await this.prisma.shoppingList.upsert({
      where: { bookingId },
      update: { generatedAt: new Date() },
      create: { bookingId },
    });

    await this.prisma.shoppingItem.deleteMany({
      where: { shoppingListId: shoppingList.id },
    });

    if (items.length) {
      await this.prisma.shoppingItem.createMany({
        data: items.map((item) => ({
          shoppingListId: shoppingList.id,
          aisle: item.aisle,
          name: item.name,
          quantity: item.quantity,
        })),
      });
    }

    return this.getByBookingId(bookingId);
  }

  private aggregateBookingIngredients(
    bookingMeals: Array<{
      portions: number;
      meal: { portions: number; ingredients: unknown };
    }>,
  ): AggregatedItem[] {
    const grouped = new Map<
      string,
      { aisle: string; name: string; amount: number; unit: string }
    >();

    for (const bookingMeal of bookingMeals) {
      const base = bookingMeal.meal.portions || 1;
      const factor = bookingMeal.portions / base;
      const ingredients = Array.isArray(bookingMeal.meal.ingredients)
        ? bookingMeal.meal.ingredients
        : [];

      for (const raw of ingredients) {
        const parsed = this.parseIngredient(raw, factor);
        if (!parsed) {
          continue;
        }
        const key = `${parsed.aisle}|${parsed.name}|${parsed.unit}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.amount += parsed.amount;
        } else {
          grouped.set(key, parsed);
        }
      }
    }

    return [...grouped.values()].map((item) => ({
      aisle: item.aisle,
      name: item.name,
      quantity: `${Number(item.amount.toFixed(2))} ${item.unit}`.trim(),
    }));
  }

  private parseIngredient(
    raw: unknown,
    factor: number,
  ): { aisle: string; name: string; amount: number; unit: string } | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const ingredient = raw as Record<string, unknown>;
    const name = String(ingredient.name ?? '').trim();
    if (!name) {
      return null;
    }

    const amountValue = Number(ingredient.amount ?? ingredient.qty ?? 1);
    const amount = Number.isFinite(amountValue) ? amountValue * factor : factor;
    const aisle = String(ingredient.aisle ?? 'other').trim() || 'other';
    const unit = String(ingredient.unit ?? '').trim();

    return {
      aisle,
      name,
      amount,
      unit,
    };
  }
}
