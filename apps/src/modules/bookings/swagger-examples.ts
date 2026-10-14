import { applyDecorators } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';

/** One row of a list: what "Mes prestations" shows, as the batch cooker sees it. */
export const BOOKING_ITEM_EXAMPLE = {
  id: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
  reference: 'LF-2026-0042',
  status: 'confirmed',
  startsAt: '2026-10-21T07:00:00.000Z',
  endsAt: '2026-10-21T10:00:00.000Z',
  bookingDate: '2026-10-21',
  timeSlot: '09:00-12:00',
  persons: 4,
  addressLine: '12 rue des Lilas, 75011 Paris',
  notes: 'Digicode 4521B, 3e étage.',
  shoppingByClient: false,
  priceCents: 24000,
  amountTtc: 24000,
  amountAfterTax: 12000,
  currency: 'EUR',
  arrivedAt: null,
  createdAt: '2026-10-14T18:02:11.000Z',
  mealsCount: 3,
  client: {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    name: 'Sophie M.',
    avatarUrl: null,
  },
  chef: { id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', displayName: 'Chef Marie D.' },
  serviceOffer: { id: '9c3ebc99-9c0b-4ef8-bb6d-6bb9bd380a99', name: 'Session 3 h' },
  formule: null,
  paymentMethods: ['cb'],
  paidCents: 24000,
  netCents: 19680,
  commissionCents: 4320,
  commissionEstimated: false,
};

export const BOOKING_DETAIL_EXAMPLE = {
  ...BOOKING_ITEM_EXAMPLE,
  meals: [
    {
      mealId: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      name: 'Poulet yassa',
      portions: 4,
      recipeVersion: 2,
    },
  ],
  photos: [],
  allergies: ['arachides'],
  diets: ['sans-porc'],
};

const without = (example: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(example).filter(([key]) => !keys.includes(key)));

/** The client never sees the commission, the net, or their own diet sheet. */
const BATCH_COOKER_ONLY = [
  'netCents',
  'commissionCents',
  'commissionEstimated',
  'allergies',
  'diets',
];
const FULL_CLIENT = { ...BOOKING_ITEM_EXAMPLE.client, name: 'Sophie Martin' };

export const CLIENT_ITEM_EXAMPLE = {
  ...without(BOOKING_ITEM_EXAMPLE, BATCH_COOKER_ONLY),
  client: FULL_CLIENT,
};

export const CLIENT_DETAIL_EXAMPLE = {
  ...without(BOOKING_DETAIL_EXAMPLE, BATCH_COOKER_ONLY),
  client: FULL_CLIENT,
  chefCesu: {
    chefProfileId: BOOKING_ITEM_EXAMPLE.chef.id,
    chefDisplayName: BOOKING_ITEM_EXAMPLE.chef.displayName,
    acceptsCesu: true,
    crcesuNan: '1234567',
    crcesuAffiliationStatus: 'active',
    supportedIssuers: ['pluxee', 'edenred', 'up', 'bimpli', 'domiserve', 'other'],
  },
};

const ADMIN_CLIENT = { ...FULL_CLIENT, email: 'sophie.martin@example.com' };
export const ADMIN_ITEM_EXAMPLE = { ...BOOKING_ITEM_EXAMPLE, client: ADMIN_CLIENT };
export const ADMIN_DETAIL_EXAMPLE = { ...BOOKING_DETAIL_EXAMPLE, client: ADMIN_CLIENT };

export const ApiBookingId = () =>
  applyDecorators(
    ApiParam({
      name: 'id',
      description: 'The booking id.',
      example: '7b1ebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
    }),
  );

/** The statuses and who moves them, said once for every PATCH. */
export const STATUS_HELP =
  'A booking is `pending` until its payments cover it, then `confirmed` (a custom ' +
  'request’s booking is `confirmed` at once and paid afterwards). The batch cooker ' +
  'then moves it to `shopping`, `cooking` (the arrival on site, from 2 h before the ' +
  'start: it records `arrivedAt`) and `delivered`; either side closes it ' +
  '`completed`. Client or batch cooker may cancel while nothing is paid and, once ' +
  'confirmed, before the start.\n\n' +
  'An unpaid `pending` booking holds its slot 72 h: both sides are reminded at 48 h, ' +
  'then it is cancelled.';
