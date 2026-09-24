import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/**
 * FLOW-02 §8: a write on a dish or menu the caller does not own. The same code
 * answers a chef touching another chef's content and an admin reaching a chef's
 * dish through the legacy Lab's Food routes.
 */
export const contentNotOwned = (
  message = 'This content belongs to someone else.',
): ForbiddenException => new ForbiddenException({ code: 'CONTENT_NOT_OWNED', message });

/**
 * FLOW-02 §3.3 and FLOW-01's browse-only rule: a batch cooker whose candidature is
 * not approved, or whose dossier is no longer validated, cannot write or publish.
 */
export const chefNotVerified = (message: string): ForbiddenException =>
  new ForbiddenException({ code: 'CHEF_NOT_VERIFIED', message });

/** A write whose result would contradict itself, or a publication check that fails. */
export const validationFailed = (
  message: string,
  details?: Record<string, unknown>,
): UnprocessableEntityException =>
  new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message, ...details });
