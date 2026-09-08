/**
 * Inserts ~10 rows per application table for local/staging exploration.
 * All rows are tagged (clerk ids, references, slugs, meal names, `pi_demoseed…` Stripe
 * ids, `DEMO-COM-…` invoice numbers) so `npm run db:unseed:demo` can remove them without
 * touching production CMS or migration formules.
 *
 * The payment side is **scenario-driven** rather than uniform: one booking per state of
 * the money flow — card, prefinanced CESU (declared / confirmed / rejected / admin
 * force-settled), a booking split between the two, and each commission-collection outcome
 * (withheld by Stripe, debited by SEPA, still processing, reversed by a CORE dispute, out
 * of debit attempts). Every combination the admin screens, the chef dashboard and the
 * fiscal attestation have to render exists in the seed.
 *
 * Amounts come from the production `computeCommission`, and the row states follow the
 * transitions in `commission-debits.service.ts`, so the demo database is a database the
 * API itself could have written.
 */
import {
  BookingStatus,
  CesuIssuer,
  CesuMedium,
  CesuSettlementStatus,
  ClientProfileStatus,
  CommissionInvoiceStatus,
  CommissionStatus,
  MealContinent,
  MealDifficulty,
  MealStatus,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
  SapDeclarationType,
  SapExternalStatus,
  SepaMandateStatus,
  UserRole,
} from '../src/generated/prisma/client';
import { loadRepoEnv } from '../src/config/env-files';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import { DEFAULT_CONCEPT_CONTENT } from '../src/modules/content-cms/concept-defaults';
import {
  computeCommission,
  SEPA_CLAWBACK_WINDOW_DAYS,
} from '../src/modules/payments/commission.util';
import {
  DEMO_COUNT,
  DEMO_MENU_YEAR,
  DEMO_SEED_TAG,
  demoAdminClerkId,
  demoAdminEmail,
  demoBookingReference,
  demoChargeId,
  demoChefClerkId,
  demoChefEmail,
  demoClientClerkId,
  demoClientEmail,
  demoCmsSlug,
  demoCommissionInvoiceNumber,
  demoCrcesuNan,
  demoDebitIntentId,
  demoFormuleId,
  demoMealName,
  demoNovaCode,
  demoPaymentIntentId,
  demoQuoteReference,
  demoStripeAccountId,
  demoStripeCustomerId,
  demoStripeEventId,
  demoStripeMandateId,
  demoStripePaymentMethodId,
  demoStripeSetupIntentId,
} from '../src/common/demo-seed-constants';
import { toInputJson } from './json-helpers';

loadRepoEnv();

const migrationUrl =
  process.env.SUPABASE_DB_MIGRATION_URL ?? process.env.SUPABASE_DB_URL ?? '';
if (!migrationUrl) {
  throw new Error('SUPABASE_DB_URL is required to run the demo seed.');
}

const { prisma, pool } = createPrismaClient(migrationUrl);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read exactly as `config.loader.ts` reads them, so a repo configured with a different
 * rate seeds amounts matching what its own API would compute.
 */
const COMMISSION_RATE_BPS = Number(process.env.PAYMENTS_COMMISSION_RATE_BPS ?? 1500);
const COMMISSION_VAT_RATE_BPS = Number(
  process.env.PAYMENTS_COMMISSION_VAT_RATE_BPS ?? 2000,
);
const DEBIT_MAX_ATTEMPTS = Number(
  process.env.PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS ?? 3,
);

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

/** How far a chef got through Stripe Connect onboarding. */
type StripeOnboarding = 'complete' | 'started' | 'none';

interface ChefPlan {
  isActive: boolean;
  isVerified: boolean;
  stripe: StripeOnboarding;
  /** `null` = a chef who has not begun the "service à la personne" paperwork at all. */
  sap: {
    declarationType: SapDeclarationType;
    urssafTiersPrestationStatus: SapExternalStatus;
    crcesuAffiliationStatus: SapExternalStatus;
    /** Opting in without a NAN is a dead end, so the NAN follows the opt-in. */
    acceptsCesu: boolean;
  } | null;
  mandate: SepaMandateStatus | null;
}

/**
 * Chefs 1-8 are vetted, which is what makes their bookings and payments legal under the
 * `isActive && isVerified` gate the booking and payment services both apply. 9 and 10 are
 * the unvetted cases the admin vetting screen exists for — deliberately without bookings,
 * since the API would refuse to create them.
 */
const chefPlans: ChefPlan[] = [
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_a_nova',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_b_cooperative',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    // Card only: affiliated to nothing on the CESU side, so `cesu-info` hides the NAN.
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_a_nova',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'not_started',
      acceptsCesu: false,
    },
    mandate: 'active',
  },
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_b_cooperative',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_a_nova',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_b_cooperative',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    // Revoked mandate — the chef whose commission debits run out of attempts below.
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_a_nova',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'revoked',
  },
  {
    isActive: true,
    isVerified: true,
    stripe: 'complete',
    sap: {
      declarationType: 'type_b_cooperative',
      urssafTiersPrestationStatus: 'active',
      crcesuAffiliationStatus: 'active',
      acceptsCesu: true,
    },
    mandate: 'active',
  },
  {
    // Onboarding under way: Stripe started, admin has not vetted. No booking, by design.
    isActive: true,
    isVerified: false,
    stripe: 'started',
    sap: {
      declarationType: 'type_a_nova',
      urssafTiersPrestationStatus: 'pending',
      crcesuAffiliationStatus: 'pending',
      acceptsCesu: false,
    },
    mandate: 'pending',
  },
  {
    // Nothing done at all.
    isActive: false,
    isVerified: false,
    stripe: 'none',
    sap: null,
    mandate: null,
  },
];

/** What happened to the platform commission on a payment. */
type CommissionOutcome =
  /** The payment has not settled, so nothing is due yet. */
  | { kind: 'pending' }
  /** The payment failed — a commission on money that never moved is dead. */
  | { kind: 'failed' }
  /** Card: Stripe withheld it at charge time as `application_fee_amount`. No facture B. */
  | { kind: 'application_fee' }
  /** CESU: facture B issued, SEPA debit settled, invoice closed. */
  | { kind: 'debit_succeeded' }
  /** CESU: debit accepted by Stripe, still travelling to the chef's bank. */
  | { kind: 'debit_processing' }
  /** CESU: debited, then clawed back inside the 8-week SEPA CORE window. Blocks the chef. */
  | { kind: 'debit_reversed' }
  /** CESU: every attempt failed, the invoice stays due. Blocks the chef. */
  | { kind: 'debit_exhausted'; failureReason: string };

interface PaymentPlan {
  method: PaymentMethod;
  /** Share of the booking total this payment covers — the shares of a split add to 1. */
  share: number;
  status: PaymentStatus;
  failureReason?: string;
  cesu?: {
    medium: CesuMedium;
    /** Only meaningful for e-CESU: paper has no issuer conversation. */
    issuer?: CesuIssuer;
    settlementStatus: CesuSettlementStatus;
    /** Settled by an admin rather than by the chef, against a proof reference. */
    adminOverride?: boolean;
  };
  commission: CommissionOutcome;
}

interface BookingPlan {
  /** 1-based index into `chefPlans` — only a vetted chef may carry a booking. */
  chef: number;
  payments: PaymentPlan[];
}

/**
 * One booking per state of the money flow. `bookingStatuses` matches, position by
 * position: a fully covered booking is `confirmed` or `completed`, an unpaid one
 * `pending`, and the cancelled one carries the failed card attempt.
 */
const bookingPlans: BookingPlan[] = [
  // 1 — card attempt created, client has not paid yet.
  {
    chef: 1,
    payments: [
      { method: 'cb', share: 1, status: 'pending', commission: { kind: 'pending' } },
    ],
  },
  // 2 — the ordinary card sale: Stripe split the commission at charge time.
  {
    chef: 2,
    payments: [
      {
        method: 'cb',
        share: 1,
        status: 'succeeded',
        commission: { kind: 'application_fee' },
      },
    ],
  },
  // 3 — card declined, booking cancelled.
  {
    chef: 3,
    payments: [
      {
        method: 'cb',
        share: 1,
        status: 'failed',
        failureReason: 'Your card was declined (insufficient_funds).',
        commission: { kind: 'failed' },
      },
    ],
  },
  // 4 — the full e-CESU run: chef confirmed, facture B cut and collected by SEPA.
  {
    chef: 4,
    payments: [
      {
        method: 'cesu',
        share: 1,
        status: 'succeeded',
        cesu: { medium: 'ecesu', issuer: 'pluxee', settlementStatus: 'confirmed' },
        commission: { kind: 'debit_succeeded' },
      },
    ],
  },
  // 5 — client declared a CESU payment, chef has not answered yet.
  {
    chef: 5,
    payments: [
      {
        method: 'cesu',
        share: 1,
        status: 'pending',
        cesu: { medium: 'ecesu', issuer: 'edenred', settlementStatus: 'declared' },
        commission: { kind: 'pending' },
      },
    ],
  },
  // 6 — paper CESU, commission collected then clawed back by a SEPA CORE dispute.
  // Chef 6 is blocked from new bookings until it is settled.
  {
    chef: 6,
    payments: [
      {
        method: 'cesu',
        share: 1,
        status: 'succeeded',
        cesu: { medium: 'cesu_paper', settlementStatus: 'confirmed' },
        commission: { kind: 'debit_reversed' },
      },
    ],
  },
  // 7 — the mixed booking: part e-CESU, the rest on card. Two payments, two commissions,
  // two collection methods, one booking.
  {
    chef: 2,
    payments: [
      {
        method: 'cesu',
        share: 0.4,
        status: 'succeeded',
        cesu: { medium: 'ecesu', issuer: 'up', settlementStatus: 'confirmed' },
        commission: { kind: 'debit_processing' },
      },
      {
        method: 'cb',
        share: 0.6,
        status: 'succeeded',
        commission: { kind: 'application_fee' },
      },
    ],
  },
  // 8 — the chef says the CESU funds never arrived.
  {
    chef: 5,
    payments: [
      {
        method: 'cesu',
        share: 1,
        status: 'failed',
        failureReason: 'No CESU transfer received from the issuer.',
        cesu: { medium: 'ecesu', issuer: 'bimpli', settlementStatus: 'rejected' },
        commission: { kind: 'failed' },
      },
    ],
  },
  // 9 — a second ordinary card sale, on the last vetted chef.
  {
    chef: 8,
    payments: [
      {
        method: 'cb',
        share: 1,
        status: 'succeeded',
        commission: { kind: 'application_fee' },
      },
    ],
  },
  // 10 — an admin force-settled the declaration, then every debit failed on a revoked
  // mandate. Facture B stays due and chef 7 is blocked from new bookings.
  {
    chef: 7,
    payments: [
      {
        method: 'cesu',
        share: 1,
        status: 'succeeded',
        cesu: {
          medium: 'ecesu',
          issuer: 'domiserve',
          settlementStatus: 'confirmed',
          adminOverride: true,
        },
        commission: {
          kind: 'debit_exhausted',
          failureReason:
            'The chef SEPA mandate is revoked; the commission cannot be debited.',
        },
      },
    ],
  },
];

/** Webhook ledger rows, so the de-duplication table is not empty in a demo database. */
const stripeEventPlans: { type: string; processed: boolean; error?: string }[] = [
  { type: 'payment_intent.succeeded', processed: true },
  { type: 'payment_intent.processing', processed: true },
  { type: 'payment_intent.payment_failed', processed: true },
  { type: 'charge.dispute.created', processed: true },
  { type: 'charge.dispute.closed', processed: true },
  { type: 'charge.refunded', processed: true },
  { type: 'account.updated', processed: true },
  { type: 'setup_intent.succeeded', processed: true },
  { type: 'mandate.updated', processed: true },
  // Received, handler threw, `processedAt` still null — exactly the row that must let
  // Stripe's retry through instead of being read as a duplicate.
  {
    type: 'payment_intent.succeeded',
    processed: false,
    error: 'Payment intent references a booking that no longer exists.',
  },
];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

async function main(): Promise<void> {
  const existing = await prisma.user.count({
    where: { clerkUserId: { startsWith: DEMO_SEED_TAG } },
  });
  if (existing > 0) {
    throw new Error(
      `Demo seed users already exist (${existing}). Run npm run db:unseed:demo first.`,
    );
  }

  const counts = {
    sapProfiles: 0,
    sepaMandates: 0,
    payments: 0,
    cesuSettlements: 0,
    commissions: 0,
    commissionInvoices: 0,
    commissionDebits: 0,
  };

  await prisma.$transaction(
    async (tx) => {
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

      // The identity recorded on an admin force-settle: a tax-credit line written in a
      // chef's name has to say who wrote it.
      const adminUser = await tx.user.create({
        data: {
          clerkUserId: demoAdminClerkId(),
          email: demoAdminEmail(),
          fullName: 'Demo Admin',
          role: UserRole.admin,
        },
      });

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
          const plan = chefPlans[idx];
          return tx.chefProfile.create({
            data: {
              userId: user.id,
              displayName: `Chef Demo ${i}`,
              bio: `Disposable demo chef profile #${i}.`,
              city: 'Paris',
              serviceRadiusKm: 15 + i,
              isActive: plan.isActive,
              isVerified: plan.isVerified,
              // Normally mirrored from `account.updated`; here they encode how far the
              // chef got, since the card flow refuses anything short of `complete`.
              ...(plan.stripe === 'none'
                ? {}
                : {
                    stripeAccountId: demoStripeAccountId(i),
                    stripeChargesEnabled: plan.stripe === 'complete',
                    stripePayoutsEnabled: plan.stripe === 'complete',
                    stripeDetailsSubmitted: plan.stripe === 'complete',
                  }),
            },
          });
        }),
      );

      const sapProfiles = await Promise.all(
        chefProfiles.flatMap((chef, idx) => {
          const i = idx + 1;
          const sap = chefPlans[idx].sap;
          if (!sap) {
            return [];
          }
          const isCooperative = sap.declarationType === 'type_b_cooperative';
          return [
            tx.sapProfile.create({
              data: {
                chefProfileId: chef.id,
                declarationType: sap.declarationType,
                // Type A declares under its own NOVA code, type B under the cooperative's.
                novaCode: isCooperative ? null : demoNovaCode(i),
                cooperativeName: isCooperative ? 'Demo Coopérative SAP' : null,
                cooperativeMembershipProof: isCooperative
                  ? `demo/sap/coop-membership-${i}.pdf`
                  : null,
                urssafTiersPrestationStatus: sap.urssafTiersPrestationStatus,
                crcesuAffiliationStatus: sap.crcesuAffiliationStatus,
                // The opt-in is only actionable with a NAN, so the two travel together.
                crcesuNan: sap.acceptsCesu ? demoCrcesuNan(i) : null,
                acceptsCesu: sap.acceptsCesu,
              },
            }),
          ];
        }),
      );
      counts.sapProfiles = sapProfiles.length;

      const sepaMandates = await Promise.all(
        chefProfiles.flatMap((chef, idx) => {
          const i = idx + 1;
          const status = chefPlans[idx].mandate;
          if (!status) {
            return [];
          }
          // A mandate only carries a payment method and an IBAN once actually signed.
          const signed = status !== 'pending';
          return [
            tx.sepaMandate.create({
              data: {
                chefProfileId: chef.id,
                status,
                stripeCustomerId: demoStripeCustomerId(i),
                stripeSetupIntentId: demoStripeSetupIntentId(i),
                stripePaymentMethodId: signed ? demoStripePaymentMethodId(i) : null,
                stripeMandateId: signed ? demoStripeMandateId(i) : null,
                ibanLast4: signed ? String(1000 + i).slice(-4) : null,
                signedAt: signed ? daysFromNow(-90 + i) : null,
              },
            }),
          ];
        }),
      );
      counts.sepaMandates = sepaMandates.length;

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
              country: 'France',
              dietaryTags: ['demo'],
              difficulty: MealDifficulty.easy,
              ingredients: toInputJson([{ name: 'Tomate', qty: '2' }]),
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
          const starts = daysFromNow(i);
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

      // Sequential, unlike the blocks above: invoice numbers and Stripe ids come from
      // running counters, and the payments of one booking depend on each other's amounts.
      const bookings: { id: string }[] = [];
      let paymentSeq = 0;
      let invoiceSeq = 0;
      let debitSeq = 0;

      for (let idx = 0; idx < DEMO_COUNT; idx++) {
        const i = idx + 1;
        const plan = bookingPlans[idx];
        const chef = chefProfiles[plan.chef - 1];
        const offer = offers[plan.chef - 1];
        const status = bookingStatuses[idx];
        // A completed or cancelled booking dated in the future would be nonsense; only
        // the live ones are ahead of today.
        const isPast = status === 'completed' || status === 'cancelled';
        const starts = daysFromNow(isPast ? -(7 + i) : 7 + i);
        starts.setHours(18, 0, 0, 0);
        const ends = new Date(starts);
        ends.setHours(21, 0, 0, 0);
        const amountTtc = offer.priceCents;
        // Position of the card attempt in this booking's payments, so the booking
        // mirrors the right intent id on a booking split between CESU and card.
        const cardIndex = plan.payments.findIndex((payment) => payment.method === 'cb');

        const booking = await tx.booking.create({
          data: {
            reference: demoBookingReference(i),
            clientId: clientUsers[idx].id,
            chefProfileId: chef.id,
            serviceOfferId: offer.id,
            formuleId: demoFormuleId(i),
            bookingDate: starts,
            timeSlot: '18:00-21:00',
            persons: 4,
            startsAt: starts,
            endsAt: ends,
            status,
            priceCents: amountTtc,
            amountTtc,
            // 50 % "service à la personne" tax credit, as `bookings.service.ts` computes it.
            amountAfterTax: Math.round(amountTtc * 0.5),
            addressLine: `${i} rue Demo, Paris`,
            notes: 'Demo booking — safe to delete.',
            // Mirrors the live card attempt, the way `createIntent` writes it back.
            ...(cardIndex >= 0
              ? {
                  stripePaymentIntentId: demoPaymentIntentId(paymentSeq + 1 + cardIndex),
                }
              : {}),
          },
        });
        bookings.push(booking);

        // A payment settles before the service is delivered, and never in the future.
        const paidAt = new Date(
          Math.min(starts.getTime() - 3 * DAY_MS, Date.now() - DAY_MS),
        );

        let remaining = amountTtc;
        for (const [paymentIdx, paymentPlan] of plan.payments.entries()) {
          paymentSeq += 1;
          // The last share takes the rounding remainder, so the payments of a split
          // booking add up to the booking total exactly.
          const isLast = paymentIdx === plan.payments.length - 1;
          const paymentAmount = isLast
            ? remaining
            : Math.round(amountTtc * paymentPlan.share);
          remaining -= paymentAmount;

          const settled = paymentPlan.status === 'succeeded';
          const isCard = paymentPlan.method === 'cb';
          const commission = computeCommission(paymentAmount, {
            rateBps: COMMISSION_RATE_BPS,
            vatRateBps: COMMISSION_VAT_RATE_BPS,
          });

          const payment = await tx.payment.create({
            data: {
              bookingId: booking.id,
              method: paymentPlan.method,
              status: paymentPlan.status,
              amountTtc: paymentAmount,
              currency: 'EUR',
              // CESU funds never transit through Stripe — the issuer credits the chef
              // directly — so a CESU payment carries no intent and no charge.
              stripePaymentIntentId: isCard ? demoPaymentIntentId(paymentSeq) : null,
              stripeChargeId: isCard && settled ? demoChargeId(paymentSeq) : null,
              // The whole TTC amount of a home session is tax-credit eligible, whatever
              // it was paid with. `settlePayment` is the only writer of these three.
              taxCreditEligibleAmount: settled ? paymentAmount : null,
              paidAt: settled ? paidAt : null,
              failureReason: paymentPlan.failureReason ?? null,
              metadata: toInputJson({ demoSeed: DEMO_SEED_TAG }),
            },
          });
          counts.payments += 1;

          if (paymentPlan.cesu) {
            const confirmed = paymentPlan.cesu.settlementStatus === 'confirmed';
            const rejected = paymentPlan.cesu.settlementStatus === 'rejected';
            const adminOverride = paymentPlan.cesu.adminOverride ?? false;
            await tx.cesuSettlement.create({
              data: {
                paymentId: payment.id,
                medium: paymentPlan.cesu.medium,
                // Paper carries no issuer: it only matters for the e-CESU conversation.
                issuer:
                  paymentPlan.cesu.medium === 'ecesu'
                    ? (paymentPlan.cesu.issuer ?? null)
                    : null,
                status: paymentPlan.cesu.settlementStatus,
                // Paper titres carry no issuer confirmation to copy a reference from.
                clientProofRef:
                  paymentPlan.cesu.medium === 'ecesu'
                    ? `DEMO-CESU-REF-${String(paymentSeq).padStart(2, '0')}`
                    : null,
                confirmedAt: confirmed ? paidAt : null,
                rejectionReason: rejected ? (paymentPlan.failureReason ?? null) : null,
                // Who settled it: the chef normally, an admin on a force-settle.
                confirmedByUserId:
                  confirmed || rejected
                    ? adminOverride
                      ? adminUser.id
                      : chefUsers[plan.chef - 1].id
                    : null,
                adminOverride,
                adminProofRef: adminOverride
                  ? 'Issuer statement forwarded by the client on 12/08.'
                  : null,
              },
            });
            counts.cesuSettlements += 1;
          }

          const outcome = paymentPlan.commission;
          const collectionMethod = isCard
            ? 'stripe_application_fee'
            : 'sepa_direct_debit';
          const commissionStatus: CommissionStatus =
            outcome.kind === 'application_fee' || outcome.kind === 'debit_succeeded'
              ? 'collected'
              : outcome.kind === 'debit_processing'
                ? 'processing'
                : outcome.kind === 'debit_reversed'
                  ? 'reversed'
                  : // A failed attempt does not cancel the receivable: the commission
                    // returns to `invoiced`, still owed.
                    outcome.kind === 'debit_exhausted'
                    ? 'invoiced'
                    : outcome.kind;

          const created = await tx.commission.create({
            data: {
              paymentId: payment.id,
              chefProfileId: chef.id,
              rateBps: commission.rateBps,
              vatRateBps: commission.vatRateBps,
              // What the rate was applied to, so an audit can replay
              // rateBps x basis = amountHt even on a booking paid in instalments.
              basisAmountCents: paymentAmount,
              amountHtCents: commission.amountHtCents,
              amountVatCents: commission.amountVatCents,
              amountTtcCents: commission.amountTtcCents,
              collectionMethod,
              status: commissionStatus,
              collectedAt: commissionStatus === 'collected' ? paidAt : null,
            },
          });
          counts.commissions += 1;

          // Card commissions never reach the debit engine: Stripe already withheld them.
          if (
            outcome.kind === 'pending' ||
            outcome.kind === 'failed' ||
            outcome.kind === 'application_fee'
          ) {
            continue;
          }

          invoiceSeq += 1;
          const issuedAt = new Date(paidAt.getTime() + 60_000);
          const invoiceStatus: CommissionInvoiceStatus =
            outcome.kind === 'debit_succeeded' ? 'settled' : 'issued';

          const invoice = await tx.commissionInvoice.create({
            data: {
              chefProfileId: chef.id,
              invoiceNumber: demoCommissionInvoiceNumber(invoiceSeq),
              issuedAt,
              amountHtCents: commission.amountHtCents,
              amountVatCents: commission.amountVatCents,
              amountTtcCents: commission.amountTtcCents,
              rateBps: commission.rateBps,
              vatRateBps: commission.vatRateBps,
              paymentMethod: paymentPlan.method,
              collectionMethod,
              status: invoiceStatus,
              // No period: these are `on_payment` invoices, one payment each, not a
              // `monthly_batch` grouping.
            },
          });
          counts.commissionInvoices += 1;

          await tx.commission.update({
            where: { id: created.id },
            data: { commissionInvoiceId: invoice.id },
          });

          if (outcome.kind === 'debit_exhausted') {
            // N attempts against one invoice: a failed debit adds an attempt, it never
            // burns a new invoice number.
            for (let attempt = 1; attempt <= DEBIT_MAX_ATTEMPTS; attempt++) {
              debitSeq += 1;
              await tx.commissionDebit.create({
                data: {
                  commissionInvoiceId: invoice.id,
                  amountTtcCents: invoice.amountTtcCents,
                  status: 'failed',
                  attemptNumber: attempt,
                  failureReason: outcome.failureReason,
                  initiatedAt: new Date(issuedAt.getTime() + attempt * 2 * DAY_MS),
                  // A precondition failure never reaches Stripe, so there is no intent.
                  stripePaymentIntentId: null,
                },
              });
              counts.commissionDebits += 1;
            }
            continue;
          }

          debitSeq += 1;
          const settledAt =
            outcome.kind === 'debit_processing'
              ? null
              : new Date(issuedAt.getTime() + 4 * DAY_MS);
          await tx.commissionDebit.create({
            data: {
              commissionInvoiceId: invoice.id,
              stripePaymentIntentId: demoDebitIntentId(debitSeq),
              amountTtcCents: invoice.amountTtcCents,
              status:
                outcome.kind === 'debit_succeeded'
                  ? 'succeeded'
                  : outcome.kind === 'debit_processing'
                    ? 'processing'
                    : 'reversed',
              attemptNumber: 1,
              initiatedAt: issuedAt,
              settledAt,
              // SEPA CORE lets the debtor revoke for eight weeks, so a settled debit is
              // only final once this date has passed.
              clawbackWindowEndsAt: settledAt
                ? new Date(settledAt.getTime() + SEPA_CLAWBACK_WINDOW_DAYS * DAY_MS)
                : null,
            },
          });
          counts.commissionDebits += 1;
        }
      }

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

      const cmsBlock = toInputJson(DEFAULT_CONCEPT_CONTENT.introBlocks);
      await Promise.all(
        Array.from({ length: DEMO_COUNT }, (_, idx) => {
          const i = idx + 1;
          return tx.cmsPage.create({
            data: {
              slug: demoCmsSlug(i),
              title: `Demo CMS page ${i}`,
              hero: toInputJson(DEFAULT_CONCEPT_CONTENT.hero),
              introBlocks: cmsBlock,
              howItWorks: toInputJson(DEFAULT_CONCEPT_CONTENT.howItWorks),
              reassuranceItems: toInputJson(DEFAULT_CONCEPT_CONTENT.reassuranceItems),
              status: 'draft',
              updatedByUserId: chefUsers[0].id,
            },
          });
        }),
      );

      await Promise.all(
        stripeEventPlans.map((event, idx) => {
          const receivedAt = daysFromNow(-(idx + 1));
          return tx.stripeEventLog.create({
            data: {
              eventId: demoStripeEventId(idx + 1),
              type: event.type,
              receivedAt,
              // The de-duplication guard tests `processedAt`, not the row's existence —
              // an unprocessed row must still let Stripe's retry through.
              processedAt: event.processed ? new Date(receivedAt.getTime() + 500) : null,
              error: event.error ?? null,
            },
          });
        }),
      );
    },
    // The payment scenarios are written sequentially, well past the 5 s default.
    { maxWait: 15_000, timeout: 120_000 },
  );

  console.log(
    `Demo seed complete: ${DEMO_COUNT} rows per table (tag: ${DEMO_SEED_TAG}).`,
  );
  console.log('Payments and commissions:', counts);
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
