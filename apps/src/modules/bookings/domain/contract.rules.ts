import { withdrawalDeadline } from './withdrawal.rules';

/**
 * The contract a booking is, under the CGV V1 (in force 2026-11-21): the three boxes
 * of the booking flow (art. 5.1) and when each is needed. Pure.
 *
 * One version covers the three texts: they are all part of the CGV.
 */
export const CONTRACT_TERMS = {
  version: '1.0',
  /** 21 November 2026, midnight in Paris. */
  inForceFrom: new Date('2026-11-20T23:00:00Z'),
  cgvText: "J'ai lu et j'accepte les Conditions Générales de Vente.",
  /** CGV art. 10.12, word for word. */
  deboursMandateText:
    "J'accepte le mandat de débours : je charge LAB'S FOOD d'acheter mes courses en " +
    "mon nom, par l'intermédiaire du batch cooker que j'ai choisi, dans la limite de " +
    'mon budget. Les courses me sont refacturées au centime près, sans marge.',
  /** CGV art. 15.3 and 15.4 (L.221-25, L.221-28 1°). */
  earlyExecutionText:
    'Je demande que la prestation commence avant la fin de mon délai de rétractation ' +
    'de 14 jours. Je reconnais que je perdrai mon droit de rétractation une fois la ' +
    'prestation entièrement exécutée, et que si je me rétracte après son début, je ' +
    'paierai la part déjà réalisée.',
} as const;

/** The boxes as the client ticks them (`ContractConsentsDto`). */
export interface ConsentsInput {
  version: string;
  cgv?: boolean;
  deboursMandate?: boolean;
  earlyExecution?: boolean;
}

/** The boxes as a booking keeps them. */
export interface ContractState {
  contractVersion: string | null;
  cgvAcceptedAt: Date | null;
  deboursMandateAcceptedAt: Date | null;
  earlyExecutionRequestedAt: Date | null;
}

export type ContractGap = 'CGV' | 'DEBOURS_MANDATE' | 'EARLY_EXECUTION';

/** The batch cooker does the shopping (pricing.ts `shoppingFee`'s condition). */
export const chefShops = (
  offer: { shoppingIncluded: boolean },
  booking: { shoppingByClient: boolean },
) => offer.shoppingIncluded && !booking.shoppingByClient;

/**
 * What the ticked boxes stamp. A box given under another version than the current
 * one counts for nothing: the client must read the current text again.
 */
export function acceptedConsents(
  input: ConsentsInput | undefined,
  now: Date,
): ContractState {
  if (!input || input.version !== CONTRACT_TERMS.version) {
    return {
      contractVersion: null,
      cgvAcceptedAt: null,
      deboursMandateAcceptedAt: null,
      earlyExecutionRequestedAt: null,
    };
  }
  return {
    contractVersion: CONTRACT_TERMS.version,
    cgvAcceptedAt: input.cgv ? now : null,
    deboursMandateAcceptedAt: input.deboursMandate ? now : null,
    earlyExecutionRequestedAt: input.earlyExecution ? now : null,
  };
}

/** Keeps what was already given, adds what is newly ticked. */
export function mergeConsents(kept: ContractState, added: ContractState): ContractState {
  return {
    contractVersion: added.contractVersion ?? kept.contractVersion,
    cgvAcceptedAt: kept.cgvAcceptedAt ?? added.cgvAcceptedAt,
    deboursMandateAcceptedAt:
      kept.deboursMandateAcceptedAt ?? added.deboursMandateAcceptedAt,
    earlyExecutionRequestedAt:
      kept.earlyExecutionRequestedAt ?? added.earlyExecutionRequestedAt,
  };
}

/**
 * The boxes still missing before the client may commit to pay.
 *
 * - The CGV, always.
 * - The débours mandate, when the batch cooker shops.
 * - The early-execution request, when the prestation starts before the withdrawal
 *   period ends. That period runs from the conclusion, not known yet at booking
 *   time: `latestConclusion` is the latest it can be (fail-closed).
 *
 * A booking made before the CGV V1 were in force needs none: the terms of its own
 * day apply (art. 2.4). Boxes sent then are kept all the same.
 */
export function contractGaps(
  state: ContractState,
  input: { chefShops: boolean; startsAt: Date; latestConclusion: Date; bookedAt: Date },
): ContractGap[] {
  if (input.bookedAt.getTime() < CONTRACT_TERMS.inForceFrom.getTime()) return [];
  const gaps: ContractGap[] = [];
  if (!state.cgvAcceptedAt) gaps.push('CGV');
  if (input.chefShops && !state.deboursMandateAcceptedAt) gaps.push('DEBOURS_MANDATE');
  const insidePeriod =
    input.startsAt.getTime() <= withdrawalDeadline(input.latestConclusion).getTime();
  if (insidePeriod && !state.earlyExecutionRequestedAt) gaps.push('EARLY_EXECUTION');
  return gaps;
}

/** The audit row's metadata: the proof of which boxes were ticked, when, and to what text. */
export function consentsAuditMetadata(consents: ContractState) {
  return {
    version: consents.contractVersion,
    cgvAcceptedAt: consents.cgvAcceptedAt?.toISOString() ?? null,
    deboursMandateAcceptedAt: consents.deboursMandateAcceptedAt?.toISOString() ?? null,
    earlyExecutionRequestedAt: consents.earlyExecutionRequestedAt?.toISOString() ?? null,
    texts: {
      ...(consents.cgvAcceptedAt && { cgv: CONTRACT_TERMS.cgvText }),
      ...(consents.deboursMandateAcceptedAt && {
        deboursMandate: CONTRACT_TERMS.deboursMandateText,
      }),
      ...(consents.earlyExecutionRequestedAt && {
        earlyExecution: CONTRACT_TERMS.earlyExecutionText,
      }),
    },
  };
}
