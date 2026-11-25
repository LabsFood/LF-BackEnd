import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { UrssafGatewayMode } from '../../config/config.loader';
import { adminMayAnswer } from './domain/urssaf-mode.rules';

export interface UrssafPaymentRequest {
  bookingId: string;
  bookingReference: string | null;
  /** The whole price of the prestation, in cents. */
  amountCents: number;
  /** What URSSAF will take from the client's account: the price less the tax credit. */
  clientShareCents: number;
}

export interface UrssafTransmission {
  /** URSSAF's identifier of the payment request. `null` in manual mode until the
   * admin records the one the intermediary gave. */
  reference: string | null;
  /** `null` in manual mode: the admin records when the request was entered. */
  transmittedAt: Date | null;
}

/**
 * The one door to URSSAF's "tiers de prestation" API.
 *
 * Everything the immediate advance needs from URSSAF goes through here, so the day
 * the access is granted (`docs/payments/Contrat API Urssaf.json`) a live
 * implementation replaces the simulated one and nothing else moves.
 *
 * ponytail: `simulated` and `manual` send nothing. In `simulated` an admin answers in
 * URSSAF's place; in `manual` the request joins the admin queue, the admin enters it
 * on the intermediary's online space (Unipros) and records the reference and answer
 * (`POST /admin/urssaf-payments/{id}/transmitted`, `.../outcome`).
 * Add the `live` mode here with the real calls, and feed the answers back through
 * `UrssafService.recordOutcome` from URSSAF's webhook or a polling job.
 */
@Injectable()
export class UrssafGateway {
  readonly mode: UrssafGatewayMode;

  constructor(config: ConfigService) {
    this.mode = config.get<UrssafGatewayMode>('urssaf.gateway', 'disabled');
  }

  /** The immediate advance is offered to clients. */
  get enabled(): boolean {
    return this.mode !== 'disabled';
  }

  /** Answers come from an admin, not from URSSAF. */
  get simulated(): boolean {
    return this.mode === 'simulated';
  }

  /** Requests go through the intermediary's online space, entered by an admin. */
  get manual(): boolean {
    return this.mode === 'manual';
  }

  /** An admin records URSSAF's answers (simulated or manual). */
  get adminAnswers(): boolean {
    return adminMayAnswer(this.mode);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the live gateway awaits URSSAF
  async submitPaymentRequest(
    _request: UrssafPaymentRequest,
  ): Promise<UrssafTransmission> {
    if (this.manual) return { reference: null, transmittedAt: null };
    return { reference: `SIM-${randomUUID()}`, transmittedAt: new Date() };
  }
}
