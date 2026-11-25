import type { UrssafGatewayMode } from '../../../config/config.loader';

/** An admin records URSSAF's answers: in place of URSSAF (simulated), or relaying
 * what the intermediary's online space shows (manual). */
export const adminMayAnswer = (mode: UrssafGatewayMode): boolean =>
  mode === 'simulated' || mode === 'manual';

/** In manual mode the admin starts each commission debit from the chef's
 * transactions summary, so a payment marked paid does not debit on its own. */
export const commissionDueAutomatically = (mode: UrssafGatewayMode): boolean =>
  mode !== 'manual';
