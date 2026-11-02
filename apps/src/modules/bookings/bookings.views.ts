import { ymd } from '../../common/paris-time';
import type { Prisma } from '../../generated/prisma/client';
import {
  allergyLabels,
  CLIENT_ALLERGY_SELECT,
} from '../allergies/domain/allergies.rules';
import { shortName } from '../messaging/domain/messaging.rules';
import { CHEF_CESU_INFO_SELECT, toChefCesuInfo } from '../payments/chef-cesu-info';
import { ACCEPTED_OFFER } from '../payments/commission-policy';
import type { CommissionRates } from '../payments/commission.util';
import { bookingEarnings } from './domain/earnings';

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
  client: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
  chefProfile: { select: CHEF_CESU_INFO_SELECT },
  serviceOffer: { select: { id: true, name: true } },
  formule: { select: { id: true, name: true } },
  // Money that came in, or a declaration waiting for its answer.
  payments: {
    where: { status: { in: ['pending', 'succeeded'] } },
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
  bookingMeals: { include: { meal: { select: { id: true, name: true } } } },
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
} satisfies Prisma.BookingInclude;

type ListRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_LIST_INCLUDE }>;
type DetailRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAIL_INCLUDE }>;

const unique = (values: string[]) => [...new Set(values)];

/** A row of "Mes prestations", of a client's bookings, or of the admin list. */
export function toBookingListItem(
  booking: ListRow,
  audience: Audience,
  rates: CommissionRates | null,
) {
  const paid = booking.payments.filter((payment) => payment.status === 'succeeded');
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
    amountTtc: booking.amountTtc,
    amountAfterTax: booking.amountAfterTax,
    currency: booking.currency,
    arrivedAt: booking.arrivedAt,
    createdAt: booking.createdAt,
    mealsCount: booking._count.bookingMeals,
    meals: booking.bookingMeals.map((line) => ({
      mealId: line.mealId,
      name: line.meal.name,
      portions: line.portions,
      recipeVersion: line.recipeVersion,
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
  };
}
