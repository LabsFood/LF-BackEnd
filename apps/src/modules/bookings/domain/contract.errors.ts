import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { CONTRACT_TERMS, type ContractGap } from './contract.rules';
import type { WithdrawalRefusal } from './withdrawal.rules';

/**
 * Boxes missing (`contractGaps`): 422 when the booking is sent, 409 when a payment
 * starts on a booking that lacks them. The front re-reads the texts of `version`.
 */
export function contractConsentRequired(
  missing: ContractGap[],
  at: 'booking' | 'payment',
) {
  const body = {
    code: 'CONTRACT_CONSENT_REQUIRED',
    message: `Tick the booking boxes first: ${missing.join(', ')}.`,
    missing,
    version: CONTRACT_TERMS.version,
  };
  return at === 'booking'
    ? new UnprocessableEntityException(body)
    : new ConflictException(body);
}

const WITHDRAWAL_MESSAGE: Record<WithdrawalRefusal, string> = {
  WITHDRAWAL_NOT_CONCLUDED:
    'This booking is not confirmed yet: cancel it instead, nothing is owed.',
  WITHDRAWAL_ALREADY_SENT: 'The withdrawal was already sent.',
  BOOKING_CANCELLED: 'This booking is cancelled.',
  WITHDRAWAL_PERIOD_OVER: 'The 14-day withdrawal period is over.',
  WITHDRAWAL_EXECUTED:
    'The prestation was fully performed at your request: it can no longer be withdrawn from.',
};

export const withdrawalRefused = (refusal: WithdrawalRefusal) =>
  new ConflictException({ code: refusal, message: WITHDRAWAL_MESSAGE[refusal] });
