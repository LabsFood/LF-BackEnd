/**
 * Inserts ~10 rows per application table for local/staging exploration.
 * All rows are tagged (clerk ids, references, slugs, meal names) so
 * `npm run db:unseed:demo` can remove them without touching migration formules.
 */
import {
  BookingStatus,
  ClientProfileStatus,
  MealContinent,
  MealDifficulty,
  MealStatus,
  QuoteStatus,
  UserRole,
} from '../src/generated/prisma/client';
import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import {
  DEMO_COUNT,
  DEMO_MENU_YEAR,
  DEMO_SEED_TAG,
  demoBookingReference,
  demoChefClerkId,
  demoChefEmail,
  demoClientClerkId,
  demoClientEmail,
  demoFormuleId,
  demoMealName,
  demoQuoteReference,
} from '../src/common/demo-seed-constants';
import { toInputJson } from './json-helpers';

loadRepoEnv();

const migrationUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
if (!migrationUrl) {
  throw new Error('SUPABASE_DB_URL is required to run the demo seed.');
}

const { prisma, pool } = createPrismaClient(migrationUrl);

const bookingStatuses: BookingStatus[] = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'pending',
  'confirmed',
  'completed',
  'pending',
  'confirmed',
  'completed',
];

const quoteStatuses: QuoteStatus[] = [
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
];

const profileStatuses: ClientProfileStatus[] = [
  'active',
  'vip',
  'prospect',
  'inactive',
  'active',
  'vip',
  'prospect',
  'active',
  'vip',
  'active',
];

async function main(): Promise<void> {
  const existing = await prisma.user.count({
    where: { clerkUserId: { startsWith: DEMO_SEED_TAG } },
  });
  if (existing > 0) {
    throw new Error(
      `Demo seed users already exist (${existing}). Run npm run db:unseed:demo first.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    for (let i = 1; i <= DEMO_COUNT; i++) {
      await tx.formule.create({
        data: {
          id: demoFormuleId(i),
          name: `Demo formule ${i}`,
          priceTtc: 12000 + i * 100,
          priceAfterTax: 10000 + i * 100,
          duration: '3h',
          mealsCount: 3 + (i % 4),
          persons: '2-6',
          features: ['demo'],
          popular: i === 2,
          active: true,
        },
      });
    }

    const clientUsers = await Promise.all(
      Array.from({ length: DEMO_COUNT }, (_, idx) => {
        const i = idx + 1;
        return tx.user.create({
          data: {
            clerkUserId: demoClientClerkId(i),
            email: demoClientEmail(i),
            fullName: `Demo Client ${i}`,
            role: UserRole.client,
            phone: `+3360000${String(1000 + i).slice(-4)}`,
          },
        });
      }),
    );

    const chefUsers = await Promise.all(
      Array.from({ length: DEMO_COUNT }, (_, idx) => {
        const i = idx + 1;
        return tx.user.create({
          data: {
            clerkUserId: demoChefClerkId(i),
            email: demoChefEmail(i),
            fullName: `Demo Chef ${i}`,
            role: UserRole.chef,
          },
        });
      }),
    );

    await Promise.all(
      clientUsers.map((user, idx) => {
        const i = idx + 1;
        return tx.clientProfile.create({
          data: {
            userId: user.id,
            dietaryPreferences: i % 2 === 0 ? ['vegetarian'] : ['none'],
            allergies: i % 3 === 0 ? ['nuts'] : [],
            spiceLevel: (i % 5) + 1,
            householdAdults: 2,
            householdKids: i % 4,
            addressCity: 'Paris',
            addressPostalCode: '75001',
            status: profileStatuses[idx],
          },
        });
      }),
    );

    const chefProfiles = await Promise.all(
      chefUsers.map((user, idx) => {
        const i = idx + 1;
        return tx.chefProfile.create({
          data: {
            userId: user.id,
            displayName: `Chef Demo ${i}`,
            bio: `Disposable demo chef profile #${i}.`,
            city: 'Paris',
            serviceRadiusKm: 15 + i,
            isActive: true,
            isVerified: i % 2 === 0,
          },
        });
      }),
    );

    const meals = await Promise.all(
      Array.from({ length: DEMO_COUNT }, (_, idx) => {
        const i = idx + 1;
        return tx.meal.create({
          data: {
            name: demoMealName(i),
            description: `Demo meal ${i} for UI testing.`,
            portions: 4,
            prepTime: 30 + i * 5,
            continent: MealContinent.europe,
            // Values the API itself would accept: ISO country, listed diet, and
            // ingredients in the shape shopping lists read.
            country: 'FR',
            dietaryTags: ['vegetarian'],
            allergensNone: true,
            difficulty: MealDifficulty.easy,
            ingredients: toInputJson([
              { name: 'Tomate', qty: 2, unit: 'pièce', aisle: 'fruits-legumes' },
            ]),
            steps: ['Prep', 'Cook', 'Serve'],
            status: MealStatus.published,
            isFeatured: i <= 3,
          },
        });
      }),
    );

    const menuWeeks = await Promise.all(
      Array.from({ length: DEMO_COUNT }, (_, idx) => {
        const i = idx + 1;
        return tx.menuWeek.create({
          data: {
            weekNumber: i,
            year: DEMO_MENU_YEAR,
            publishedAt: new Date(),
          },
        });
      }),
    );

    await Promise.all(
      menuWeeks.map((week, idx) =>
        tx.menuWeekMeal.create({
          data: {
            menuWeekId: week.id,
            mealId: meals[idx].id,
          },
        }),
      ),
    );

    const offers = await Promise.all(
      chefProfiles.map((chef, idx) => {
        const i = idx + 1;
        return tx.serviceOffer.create({
          data: {
            chefProfileId: chef.id,
            name: `Demo offer ${i}`,
            description: 'Disposable service offer.',
            durationMinutes: 180,
            priceCents: 15000 + i * 500,
            isActive: true,
          },
        });
      }),
    );

    await Promise.all(
      chefProfiles.map((chef, idx) => {
        const i = idx + 1;
        const starts = new Date();
        starts.setDate(starts.getDate() + i);
        starts.setHours(10, 0, 0, 0);
        const ends = new Date(starts);
        ends.setHours(13, 0, 0, 0);
        return tx.availabilitySlot.create({
          data: {
            chefProfileId: chef.id,
            startsAt: starts,
            endsAt: ends,
            isBooked: i % 3 === 0,
          },
        });
      }),
    );

    const bookings = await Promise.all(
      Array.from({ length: DEMO_COUNT }, (_, idx) => {
        const i = idx + 1;
        const starts = new Date();
        starts.setDate(starts.getDate() + 7 + i);
        starts.setHours(18, 0, 0, 0);
        const ends = new Date(starts);
        ends.setHours(21, 0, 0, 0);
        return tx.booking.create({
          data: {
            reference: demoBookingReference(i),
            clientId: clientUsers[idx].id,
            chefProfileId: chefProfiles[idx].id,
            serviceOfferId: offers[idx].id,
            formuleId: demoFormuleId(i),
            bookingDate: starts,
            timeSlot: '18:00-21:00',
            persons: 4,
            startsAt: starts,
            endsAt: ends,
            status: bookingStatuses[idx],
            priceCents: offers[idx].priceCents,
            amountTtc: offers[idx].priceCents,
            addressLine: `${i} rue Demo, Paris`,
            notes: 'Demo booking — safe to delete.',
          },
        });
      }),
    );

    // One conversation per booked pair, so the messaging screens have something to
    // show while bookings cannot be created through the API. Removed with the demo
    // users: conversations cascade from them.
    await Promise.all(
      bookings
        .filter((booking) => booking.status !== 'cancelled')
        .map((booking, idx) => {
          const sentAt = new Date(Date.now() - (idx + 1) * 60 * 60 * 1000);
          const answeredAt = new Date(sentAt.getTime() + 20 * 60 * 1000);
          const chefUserId = chefProfiles.find(
            (chef) => chef.id === booking.chefProfileId,
          )!.userId;
          return tx.conversation.create({
            data: {
              type: 'chef_client',
              clientId: booking.clientId,
              chefProfileId: booking.chefProfileId,
              lastMessageAt: answeredAt,
              participants: {
                create: [
                  { userId: booking.clientId, role: 'client', unreadCount: 1 },
                  { userId: chefUserId, role: 'chef', lastReadAt: answeredAt },
                ],
              },
              messages: {
                create: [
                  {
                    senderUserId: booking.clientId,
                    senderRole: 'client',
                    body: 'Bonjour ! Est-ce que vous pouvez prévoir un plat sans gluten ?',
                    createdAt: sentAt,
                  },
                  {
                    senderUserId: chefUserId,
                    senderRole: 'chef',
                    body: 'Bonjour, bien sûr, je le note pour la session.',
                    createdAt: answeredAt,
                  },
                ],
              },
            },
          });
        }),
    );

    await Promise.all(
      bookings.map((booking, idx) =>
        tx.bookingMeal.create({
          data: {
            bookingId: booking.id,
            mealId: meals[idx].id,
            portions: 4,
          },
        }),
      ),
    );

    await Promise.all(
      bookings.map(async (booking, idx) => {
        const list = await tx.shoppingList.create({
          data: { bookingId: booking.id },
        });
        await tx.shoppingItem.create({
          data: {
            shoppingListId: list.id,
            aisle: 'Produce',
            name: `Demo ingredient ${idx + 1}`,
            quantity: '1 kg',
          },
        });
      }),
    );

    await Promise.all(
      clientUsers.map((client, idx) => {
        const i = idx + 1;
        return tx.quote.create({
          data: {
            reference: demoQuoteReference(i),
            clientId: client.id,
            title: `Demo quote request ${i}`,
            persons: 4 + (i % 3),
            mealsCount: 3,
            cuisine: 'French',
            diet: ['demo'],
            brief: 'Disposable quote for admin dashboard testing.',
            status: quoteStatuses[idx],
            assignedChefUserId: chefUsers[idx].id,
            quoteAmountTtc: 20000 + i * 100,
          },
        });
      }),
    );
  });

  console.log(
    `Demo seed complete: ${DEMO_COUNT} rows per table (tag: ${DEMO_SEED_TAG}).`,
  );
  console.log('Remove with: npm run db:unseed:demo');
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
