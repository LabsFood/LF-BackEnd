import { Prisma } from '../../generated/prisma/client';
import { CLIENT_ALLERGY_SELECT, allergyCheck } from '../allergies/domain/allergies.rules';
import { shortName } from '../messaging/domain/messaging.rules';
import { ACTIVE_OFFER } from './domain/quote.rules';

/** Everything a request is shown with, whoever looks at it. */
export const QUOTE_INCLUDE = {
  client: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      clientProfile: { select: CLIENT_ALLERGY_SELECT },
    },
  },
  offers: {
    orderBy: { createdAt: 'desc' },
    include: {
      dishes: {
        orderBy: { position: 'asc' },
        include: {
          meal: {
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              allergens: true,
              allergensNone: true,
              allergensVerifiedAt: true,
              expressQuoteId: true,
            },
          },
          menu: { select: { id: true, title: true } },
        },
      },
    },
  },
  booking: { select: { id: true, reference: true, startsAt: true, endsAt: true } },
} satisfies Prisma.QuoteInclude;

export type LoadedQuote = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;
type LoadedOffer = LoadedQuote['offers'][number];

/** The batch cooker a request is with, resolved from `assignedChefUserId`. */
export interface AssignedChef {
  userId: string;
  chefProfileId: string;
  displayName: string;
  city: string | null;
  avatarUrl: string | null;
}

export type Viewer = 'client' | 'chef' | 'admin';

const dateOnly = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;

/**
 * An offer as one side reads it. The client sees what they pay, never what the
 * batch cooker earns nor the commission between the two.
 */
export function toOfferView(offer: LoadedOffer, viewer: Viewer, quote: AllergyContext) {
  const dishes = offer.dishes.map(({ meal, menu }) => ({
    id: meal.id,
    name: meal.name,
    description: meal.description,
    imageUrl: meal.imageUrl,
    /** Written in a few words for this request: no recipe, never verified. */
    express: meal.expressQuoteId !== null,
    menu,
    allergens: meal.allergens,
    allergensNone: meal.allergensNone,
    allergensVerified: meal.allergensVerifiedAt !== null,
  }));
  return {
    id: offer.id,
    status: offer.status,
    clientPriceCents: offer.clientPriceCents,
    afterTaxCreditCents: offer.afterTaxCreditCents,
    ...(viewer === 'client'
      ? {}
      : { netCents: offer.netCents, commissionBps: offer.commissionBps }),
    proposedDate: dateOnly(offer.proposedDate),
    proposedTimeSlot: offer.proposedTimeSlot,
    conditions: offer.conditions,
    validUntil: offer.validUntil,
    viewedAt: offer.viewedAt,
    decidedAt: offer.decidedAt,
    declineReason: offer.declineReason,
    createdAt: offer.createdAt,
    dishes,
    allergy: dishes.length ? offerAllergyWarning(offer, quote) : null,
  };
}

/** What the allergy warning of an offer reads: the client's answer, the request's words. */
type AllergyContext = Pick<LoadedQuote, 'allergies'> & {
  client: Pick<LoadedQuote['client'], 'clientProfile'>;
};

/**
 * The offer's dishes against the client's allergies (Recettes lot 1 rules). On a
 * custom request it warns and invites to talk in the messagerie; it never blocks
 * (decision of 15/11). An express dish is never verified, so it always warns.
 */
function offerAllergyWarning(offer: LoadedOffer, quote: AllergyContext) {
  const dishes = offer.dishes.map(({ meal }) => ({
    id: meal.id,
    allergens: meal.allergens,
    allergensNone: meal.allergensNone,
    allergensVerifiedAt: meal.allergensVerifiedAt,
  }));
  const check = allergyCheck(quote.client.clientProfile, dishes, quote.allergies);
  return {
    check: check.allergyCheck,
    reasons: check.allergyCheckReasons,
    conflicts: check.allergyConflicts,
  };
}

export function toQuoteView(
  quote: LoadedQuote,
  chef: AssignedChef | null,
  viewer: Viewer,
) {
  const offers = quote.offers.map((offer) => toOfferView(offer, viewer, quote));
  const active = quote.offers.find((offer) =>
    (ACTIVE_OFFER as readonly string[]).includes(offer.status),
  );
  // A batch cooker learns the street and the client's contact details with the
  // accepted offer, not before: until then they need the town to price travel,
  // nothing more.
  const disclosed = viewer !== 'chef' || quote.status === 'accepted';

  return {
    id: quote.id,
    reference: quote.reference,
    status: quote.status,
    title: quote.title,
    occasion: quote.occasion,
    persons: quote.persons,
    mealsCount: quote.mealsCount,
    cuisine: quote.cuisine,
    diet: quote.diet,
    allergies: quote.allergies,
    brief: quote.brief,
    desiredDate: dateOnly(quote.desiredDate),
    timeSlot: quote.timeSlot,
    address: {
      line: disclosed ? quote.addressLine : null,
      city: quote.addressCity,
      postalCode: quote.addressPostalCode,
    },
    budgetCents: quote.budgetCents,
    client:
      viewer === 'client'
        ? undefined
        : {
            id: quote.client.id,
            name: disclosed
              ? (quote.client.fullName ?? 'Client')
              : shortName(quote.client.fullName),
            email: disclosed ? quote.client.email : null,
            phone: disclosed ? quote.client.phone : null,
          },
    chef,
    chefDeclinedAt: quote.chefDeclinedAt,
    // Why a batch cooker said no is for the admin who reassigns, not for the client.
    chefDeclineReason: viewer === 'admin' ? quote.chefDeclineReason : undefined,
    offers,
    activeOffer: active ? toOfferView(active, viewer, quote) : null,
    booking: quote.booking,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    // Kept for the callers written before offers existed.
    clientId: quote.clientId,
    assignedChefUserId: quote.assignedChefUserId,
    assignedChef: chef
      ? {
          userId: chef.userId,
          chefProfileId: chef.chefProfileId,
          displayName: chef.displayName,
        }
      : null,
  };
}

export type QuoteView = ReturnType<typeof toQuoteView>;
