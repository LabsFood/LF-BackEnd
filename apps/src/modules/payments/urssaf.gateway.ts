import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { UrssafGatewayMode } from '../../config/config.loader';

export interface UrssafPaymentRequest {
  bookingId: string;
  bookingReference: string | null;
  /** The whole price of the prestation, in cents. */
  amountCents: number;
  /** What URSSAF will take from the client's account: the price less the tax credit. */
  clientShareCents: number;
}

export interface UrssafTransmission {
  /** URSSAF's identifier of the payment request. */
  reference: string;
  transmittedAt: Date;
}

/**
 * The one door to URSSAF's "tiers de prestation" API.
 *
 * Everything the immediate advance needs from URSSAF goes through here, so the day
 * the access is granted (`docs/payments/Contrat API Urssaf.json`) a live
 * implementation replaces the simulated one and nothing else moves.
 *
 * ponytail: only `simulated` exists. It sends nothing: the request is recorded, and
 * an admin answers in URSSAF's place (`POST /admin/urssaf-payments/{id}/outcome`).
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

  // eslint-disable-next-line @typescript-eslint/require-await -- the live gateway awaits URSSAF
  async submitPaymentRequest(
    _request: UrssafPaymentRequest,
  ): Promise<UrssafTransmission> {
    return { reference: `SIM-${randomUUID()}`, transmittedAt: new Date() };
  }
}
