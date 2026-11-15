import { ymd } from '../../common/paris-time';
import type { Prisma } from '../../generated/prisma/client';
import {
  allergyCheck,
  allergyLabels,
  CLIENT_ALLERGY_SELECT,
  DISH_ALLERGEN_SELECT,
} from '../allergies/domain/allergies.rules';
import { shortName } from '../messaging/domain/messaging.rules';
import { CHEF_CESU_INFO_SELECT, toChefCesuInfo } from '../payments/chef-cesu-info';
import { ACCEPTED_OFFER } from '../payments/commission-policy';
import type { CommissionRates } from '../payments/commission.util';
import { CHEF_LEGAL_SELECT, publicChefLegalIdentity } from '../users/chef-legal.views';
import { bookingEarnings } from './domain/earnings';
import { menuFreeze } from './domain/menu-freeze.rules';
import { withdrawalFor, type WithdrawableBooking } from './domain/withdrawal.rules';

/**
 * How a booking is shown, per audience. One query per list: everything a row
 * needs comes with it.
 *
 * - The client sees their own bookings: no commission, no net.
 * - The batch cooker sees what they earn, the client's first name and initial, and,
 *   on the detail, what the client cannot eat.
 * - An admin sees everything, the client's email included.
 */
export type Audience = 'client' | 'chef' | 'admin';

export const BOOKING_LIST_INCLUDE = {
  client: {
    select: {
      id: true,
      fullName: true,
      email: true,
      avatarUrl: true,
      // Read to say "verified" or why not; the values never leave in a list.
      clientProfile: { select: CLIENT_ALLERGY_SELECT },
    },
  },
  chefProfile: { select: CHEF_CESU_INFO_SELECT },
  serviceOffer: { select: { id: true, name: true } },
  formule: { select: { id: true, name: true } },
  // Money that came in, or a declaration waiting for its answer.
  // Recettes lot 6: the service only; groceries are paid apart.
  payments: {
    where: { status: { in: ['pending', 'succeeded'] }, purpose: 'service' },
    select: {
      method: true,
      status: true,
      amountTtc: true,
      commission: { select: { amountTtcCents: true } },
    },
  },
  quote: { select: { allergies: true, diet: true, offers: ACCEPTED_OFFER } },
  _count: { select: { bookingMeals: true } },
  // The dishes ride on every row: a list that says "dishes to define" for a booking
  // that has three is wrong, and the names are cheap (a page is at most a few dozen).
  // The recipe stays off the booking (FLOW-02 §8): it is on the recipe sheet.
  bookingMeals: {
    include: { meal: { select: { ...DISH_ALLERGEN_SELECT, name: true } } },
  },
} satisfies Prisma.BookingInclude;

export const RESCHEDULE_VIEW = {
  id: true,
  proposedByRole: true,
  fromStartsAt: true,
  toStartsAt: true,
  status: true,
  expiresAt: true,
  decidedAt: true,
} as const satisfies Prisma.BookingRescheduleSelect;

export type RescheduleRow = Prisma.BookingRescheduleGetPayload<{
  select: typeof RESCHEDULE_VIEW;
}>;

/** A proposal to move a prestation, as both sides and admins see it. */
export const toRescheduleView = (row: RescheduleRow) => ({
  id: row.id,
  proposedBy: row.proposedByRole as 'client' | 'chef',
  from: row.fromStartsAt,
  to: row.toStartsAt,
  status: row.status,
  expiresAt: row.expiresAt,
  decidedAt: row.decidedAt,
});

export const BOOKING_DETAIL_INCLUDE = {
  ...BOOKING_LIST_INCLUDE,
  client: {
    select: {
      ...BOOKING_LIST_INCLUDE.client.select,
      clientProfile: { select: { ...CLIENT_ALLERGY_SELECT, dietaryPreferences: true } },
    },
  },
  photos: { orderBy: { takenAt: 'asc' } },
  // A new time waiting for an answer: one at most.
  reschedules: { where: { status: 'pending' }, take: 1, select: RESCHEDULE_VIEW },
  // CGV art. 3.2: the client reads who they contract with.
  chefProfile: {
    select: {
      ...CHEF_CESU_INFO_SELECT,
      ...CHEF_LEGAL_SELECT,
      sapProfile: {
        select: { ...CHEF_CESU_INFO_SELECT.sapProfile.select, novaCode: true },
      },
    },
  },
} satisfies Prisma.BookingInclude;

type ListRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_LIST_INCLUDE }>;
type DetailRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAIL_INCLUDE }>;

const unique = (values: string[]) => [...new Set(values)];

/** Recettes lot 1, read live: an allergy declared after booking still counts. */
const checkOf = (booking: ListRow) =>
  allergyCheck(
    booking.client.clientProfile,
    booking.bookingMeals.map((line) => line.meal),
    booking.quote?.allergies ?? [],
  );

/** A row of "Mes prestations", of a client's bookings, or of the admin list. */
export function toBookingListItem(
  booking: ListRow,
  audience: Audience,
  rates: CommissionRates | null,
) {
  const paid = booking.payments.filter((payment) => payment.status === 'succeeded');
  const check = checkOf(booking);
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    bookingDate: booking.bookingDate ? ymd(booking.bookingDate) : null,
    timeSlot: booking.timeSlot,
    persons: booking.persons,
    addressLine: booking.addressLine,
    city: booking.addressCity,
    notes: booking.notes,
    shoppingByClient: booking.shoppingByClient,
    /** The offer's price alone; each supplement apart; `amountTtc` is all of it. */
    priceCents: booking.priceCents,
    /** Extra dishes asked for, beyond what the offer covers: the batch cooker cooks them. */
    extraMeals: booking.extraMeals,
    extraPersonsCents: booking.extraPersonsCents,
    extraMealsCents: booking.extraMealsCents,
    shoppingFeeCents: booking.shoppingFeeCents,
    /** Recettes lot 4: « Courses faites », and the receipt total the chef may have typed. */
    groceriesValidatedAt: booking.groceriesValidatedAt,
    groceriesAmountCents: booking.groceriesAmountCents,
    amountTtc: booking.amountTtc,
    amountAfterTax: booking.amountAfterTax,
    currency: booking.currency,
    arrivedAt: booking.arrivedAt,
    createdAt: booking.createdAt,
    mealsCount: booking._count.bookingMeals,
    /** `verified` only when nothing is left to check by hand; the reasons say what is. */
    allergyCheck: check.allergyCheck,
    allergyCheckReasons: check.allergyCheckReasons,
    // Recettes lot 3 (LF-0269): computed from `startsAt`, never stored.
    ...menuFreeze(booking.startsAt),
    meals: booking.bookingMeals.map((line) => ({
      mealId: line.mealId,
      name: line.meal.name,
      portions: line.portions,
      recipeVersion: line.recipeVersion,
      /** Lot 3 (LF-0268): the allergens kept for this prestation; null until pinned. */
      allergensSnapshot: line.pinnedAt ? line.allergensSnapshot : null,
      pinnedAt: line.pinnedAt,
    })),
    client: {
      id: booking.client.id,
      name:
        audience === 'chef'
          ? shortName(booking.client.fullName)
          : booking.client.fullName,
      avatarUrl: booking.client.avatarUrl,
      ...(audience === 'admin' && { email: booking.client.email }),
    },
    chef: { id: booking.chefProfile.id, displayName: booking.chefProfile.displayName },
    serviceOffer: booking.serviceOffer,
    formule: booking.formule,
    /** `cb`, `avance_immediate`, `cesu`: a booking can be split between two. */
    // A card intent left `pending` may be abandoned for good: only money that came
    // in, or a CESU or URSSAF answer awaited, says how the booking is paid.
    paymentMethods: unique(
      booking.payments
        .filter((payment) => payment.status === 'succeeded' || payment.method !== 'cb')
        .map((payment) => payment.method),
    ),
    paidCents: paid.reduce((sum, payment) => sum + payment.amountTtc, 0),
    /** Set when the client withdrew online (CGV art. 15): the booking is `cancelled`. */
    withdrawnAt: booking.withdrawnAt,
    ...(audience !== 'client' &&
      rates &&
      bookingEarnings({ ...booking, offer: booking.quote?.offers[0] ?? null }, rates)),
  };
}

export function toBookingDetail(
  booking: DetailRow,
  audience: Audience,
  rates: CommissionRates | null,
) {
  const profile = booking.client.clientProfile;
  return {
    ...toBookingListItem(booking, audience, rates),
    photos: booking.photos.map((photo) => ({
      id: photo.id,
      url: photo.url,
      caption: photo.caption,
      takenAt: photo.takenAt,
    })),
    reschedule: booking.reschedules[0] ? toRescheduleView(booking.reschedules[0]) : null,
    /** Dishes holding one of the client's allergens: to replace (`…/meals/replace`). */
    allergyConflicts: checkOf(booking).allergyConflicts,
    // Read live: an allergy added after booking must still reach the cook.
    ...(audience !== 'client' && {
      allergies: allergyLabels(profile, booking.quote?.allergies ?? []),
      diets: unique([
        ...(profile?.dietaryPreferences ?? []),
        ...(booking.quote?.diet ?? []),
      ]),
    }),
    // A client paying in CESU first adds the batch cooker on their issuer's portal.
    ...(audience === 'client' && { chefCesu: toChefCesuInfo(booking.chefProfile) }),
    // Recettes lot 4 (LF-0296): when each in-app reminder of the shopping list went out.
    ...(audience === 'admin' && {
      shoppingReminders: {
        chefSendAt: booking.listReminderChefAt,
        clientAnswerAt: booking.listReminderClientAt,
        clientFrozenAt: booking.listFrozenNotifiedAt,
        chefGroceriesAt: booking.groceriesReminderAt,
      },
    }),
    /** The boxes ticked and when the contract was concluded (CGV art. 5.1). */
    contract: {
      version: booking.contractVersion,
      cgvAcceptedAt: booking.cgvAcceptedAt,
      deboursMandateAcceptedAt: booking.deboursMandateAcceptedAt,
      earlyExecutionRequestedAt: booking.earlyExecutionRequestedAt,
      concludedAt: booking.concludedAt,
    },
    ...(audience !== 'chef' && {
      chef: {
        id: booking.chefProfile.id,
        displayName: booking.chefProfile.displayName,
        legalIdentity: publicChefLegalIdentity(booking.chefProfile),
      },
      withdrawal: withdrawalView(booking, paidOf(booking), new Date()),
      /** The contract documents, at `GET /me/bookings/{id}/documents/{kind}`. */
      documents: bookingDocuments(booking),
    }),
  };
}

const paidOf = (booking: ListRow) =>
  booking.payments
    .filter((payment) => payment.status === 'succeeded')
    .reduce((sum, payment) => sum + payment.amountTtc, 0);

/**
 * The « Se rétracter » button (CGV art. 15.2): offered while `open`, until
 * `availableUntil`. Once sent: when, and what remains due and to refund.
 * `null` before the contract is concluded: a pending booking is simply cancelled.
 */
export function withdrawalView(
  booking: WithdrawableBooking & { withdrawalDueCents: number | null },
  paidCents: number,
  now: Date,
) {
  const rule = withdrawalFor(booking, paidCents, now);
  if (booking.withdrawnAt) {
    const due = booking.withdrawalDueCents;
    return {
      open: false,
      refusal: rule.refusal,
      availableUntil: rule.availableUntil,
      submittedAt: booking.withdrawnAt,
      amountDueCents: due,
      // What is left to give back: an admin refunding brings it down.
      refundCents: due === null ? null : Math.max(0, paidCents - due),
    };
  }
  if (!booking.concludedAt) return null;
  return {
    open: rule.refusal === null,
    refusal: rule.refusal,
    availableUntil: rule.availableUntil,
    submittedAt: null,
    amountDueCents: rule.dueCents,
    refundCents: rule.refundCents,
  };
}

export type BookingDocumentKind = 'cgv' | 'withdrawal-form' | 'debours-mandate';

/** The documents of a booking's contract, each a PDF the client can download. */
export function bookingDocuments(booking: {
  reference: string | null;
  id: string;
  contractVersion: string | null;
  concludedAt: Date | null;
  deboursMandateAcceptedAt: Date | null;
}): { kind: BookingDocumentKind; filename: string }[] {
  const ref = booking.reference ?? booking.id;
  return [
    ...(booking.contractVersion
      ? [
          {
            kind: 'cgv' as const,
            filename: `CGV-LabsFood-v${booking.contractVersion}.pdf`,
          },
        ]
      : []),
    ...(booking.contractVersion || booking.concludedAt
      ? [
          {
            kind: 'withdrawal-form' as const,
            filename: `formulaire-retractation-${ref}.pdf`,
          },
        ]
      : []),
    ...(booking.deboursMandateAcceptedAt
      ? [{ kind: 'debours-mandate' as const, filename: `mandat-debours-${ref}.pdf` }]
      : []),
  ];
}
