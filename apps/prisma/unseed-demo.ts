/**
 * Removes all rows created by seed-demo.ts (tagged demo data only).
 */
import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import {
  DEMO_MENU_YEAR,
  DEMO_SEED_TAG,
  demoFormuleId,
  demoMealName,
} from '../src/common/demo-seed-constants';

loadRepoEnv();

const migrationUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
if (!migrationUrl) {
  throw new Error('SUPABASE_DB_URL is required to run the demo unseed.');
}

const { prisma, pool } = createPrismaClient(migrationUrl);

async function main(): Promise<void> {
  const demoUsers = await prisma.user.findMany({
    where: { clerkUserId: { startsWith: DEMO_SEED_TAG } },
    select: { id: true },
  });

  if (demoUsers.length === 0) {
    console.log('No demo seed data found — nothing to delete.');
    return;
  }

  const userIds = demoUsers.map((u) => u.id);

  const demoBookings = await prisma.booking.findMany({
    where: {
      OR: [{ clientId: { in: userIds } }, { reference: { startsWith: 'DEMO-' } }],
    },
    select: { id: true },
  });
  const bookingIds = demoBookings.map((b) => b.id);

  const demoLists = await prisma.shoppingList.findMany({
    where: { bookingId: { in: bookingIds } },
    select: { id: true },
  });

  const { count: items } = await prisma.shoppingItem.deleteMany({
    where: { shoppingListId: { in: demoLists.map((l) => l.id) } },
  });

  const { count: lists } = await prisma.shoppingList.deleteMany({
    where: { id: { in: demoLists.map((l) => l.id) } },
  });

  const { count: bookingMeals } = await prisma.bookingMeal.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });

  const { count: bookings } = await prisma.booking.deleteMany({
    where: { id: { in: bookingIds } },
  });

  const { count: quotes } = await prisma.quote.deleteMany({
    where: { clientId: { in: userIds } },
  });

  const { count: slots } = await prisma.availabilitySlot.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
  });

  const { count: offers } = await prisma.serviceOffer.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
  });

  const demoWeeks = await prisma.menuWeek.findMany({
    where: { year: DEMO_MENU_YEAR },
    select: { id: true },
  });

  const { count: weekMeals } = await prisma.menuWeekMeal.deleteMany({
    where: { menuWeekId: { in: demoWeeks.map((w) => w.id) } },
  });

  const { count: weeks } = await prisma.menuWeek.deleteMany({
    where: { id: { in: demoWeeks.map((w) => w.id) } },
  });

  const { count: meals } = await prisma.meal.deleteMany({
    where: { name: { startsWith: '[demo]' } },
  });

  const formuleIds = Array.from({ length: 10 }, (_, i) => demoFormuleId(i + 1));
  const { count: formules } = await prisma.formule.deleteMany({
    where: { id: { in: formuleIds } },
  });

  const { count: chefs } = await prisma.chefProfile.deleteMany({
    where: { userId: { in: userIds } },
  });

  const { count: clients } = await prisma.clientProfile.deleteMany({
    where: { userId: { in: userIds } },
  });

  const { count: users } = await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });

  console.log('Demo unseed removed:');
  console.log({
    shoppingItems: items,
    shoppingLists: lists,
    bookingMeals,
    bookings,
    quotes,
    availabilitySlots: slots,
    serviceOffers: offers,
    menuWeekMeals: weekMeals,
    menuWeeks: weeks,
    meals,
    formules,
    chefProfiles: chefs,
    clientProfiles: clients,
    users,
  });
  console.log(`(Meal filter: names like "${demoMealName(1).slice(0, 6)}…")`);
}

async function shutdown(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}

main()
  .then(() => shutdown())
  .catch(async (error: unknown) => {
    console.error(error);
    await shutdown();
    process.exit(1);
  });
