import type { ConfigService } from '@nestjs/config';

import { UrssafGateway } from './urssaf.gateway';

const gateway = (mode: string) =>
  new UrssafGateway({ get: () => mode } as unknown as ConfigService);

const REQUEST = {
  bookingId: 'b1',
  bookingReference: null,
  amountCents: 10000,
  clientShareCents: 5000,
};

describe('UrssafGateway', () => {
  it('sends nothing in manual mode: the request waits for the admin', async () => {
    const manual = gateway('manual');
    expect(manual.enabled).toBe(true);
    expect(manual.adminAnswers).toBe(true);
    await expect(manual.submitPaymentRequest(REQUEST)).resolves.toEqual({
      reference: null,
      transmittedAt: null,
    });
  });

  it('keeps a simulated reference in simulated mode', async () => {
    const sim = gateway('simulated');
    const { reference } = await sim.submitPaymentRequest(REQUEST);
    expect(reference).toMatch(/^SIM-/);
  });

  it('lets no admin answer when disabled', () => {
    expect(gateway('disabled').adminAnswers).toBe(false);
  });
});
