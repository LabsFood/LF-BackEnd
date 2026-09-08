/**
 * Removes all rows created by seed-demo.ts (tagged demo data only).
 *
 * Deletion order matters and is not alphabetical: `Payment -> Booking`,
 * `Commission -> Payment`, `CommissionDebit -> CommissionInvoice` and
 * `CommissionInvoice -> ChefProfile` are all `onDelete: Restrict`, so the money rows come
 * off first, deepest child first. `Commission.commissionInvoiceId` is a plain nullable FK
 * with no cascade either, which is why commissions go before the invoices they are billed
 * on.
 */
import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import {
  DEMO_MENU_YEAR,
  DEMO_SEED_TAG,
  DEMO_STRIPE_EVENT_PREFIX,
  demoCmsSlug,
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

  // Webhook log rows hang off no demo user, so they are removed whether or not any
  // demo user survived.
  const { count: stripeEvents } = await prisma.stripeEventLog.deleteMany({
    where: { eventId: { startsWith: DEMO_STRIPE_EVENT_PREFIX } },
  });

  if (demoUsers.length === 0) {
    console.log(
      `No demo seed users found — removed ${stripeEvents} demo Stripe event log rows.`,
    );
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

  // --- Money rows, deepest child first ---------------------------------------------

  const { count: commissionDebits } = await prisma.commissionDebit.deleteMany({
    where: { commissionInvoice: { chefProfile: { userId: { in: userIds } } } },
  });

  // Before the invoices: a commission carries `commissionInvoiceId`, and before the
  // payments: `Commission -> Payment` is `Restrict`.
  const { count: commissions } = await prisma.commission.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
  });

  const { count: commissionInvoices } = await prisma.commissionInvoice.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
  });

  // Cascades from the payment anyway; deleted explicitly so the count is reported.
  const { count: cesuSettlements } = await prisma.cesuSettlement.deleteMany({
    where: { payment: { bookingId: { in: bookingIds } } },
  });

  const { count: payments } = await prisma.payment.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });

  // --- Booking rows -----------------------------------------------------------------

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

  const cmsSlugs = Array.from({ length: 10 }, (_, i) => demoCmsSlug(i + 1));
  const { count: cmsPages } = await prisma.cmsPage.deleteMany({
    where: { slug: { in: cmsSlugs } },
  });

  const formuleIds = Array.from({ length: 10 }, (_, i) => demoFormuleId(i + 1));
  const { count: formules } = await prisma.formule.deleteMany({
    where: { id: { in: formuleIds } },
  });

  // --- Chef paperwork and identities ------------------------------------------------

  // Both cascade from `ChefProfile`; deleted explicitly so the counts are reported.
  const { count: sepaMandates } = await prisma.sepaMandate.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
  });

  const { count: sapProfiles } = await prisma.sapProfile.deleteMany({
    where: { chefProfile: { userId: { in: userIds } } },
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
    commissionDebits,
    commissions,
    commissionInvoices,
    cesuSettlements,
    payments,
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
    cmsPages,
    formules,
    sepaMandates,
    sapProfiles,
    chefProfiles: chefs,
    clientProfiles: clients,
    users,
    stripeEventLogs: stripeEvents,
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
