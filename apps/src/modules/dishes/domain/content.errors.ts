import { ForbiddenException } from '@nestjs/common';

/**
 * FLOW-02 §8: a write on a dish or menu the caller does not own. The same code
 * answers a chef touching another chef's content and an admin reaching a chef's
 * dish through the legacy Lab's Food routes.
 */
export const contentNotOwned = (
  message = 'This content belongs to someone else.',
): ForbiddenException => new ForbiddenException({ code: 'CONTENT_NOT_OWNED', message });
