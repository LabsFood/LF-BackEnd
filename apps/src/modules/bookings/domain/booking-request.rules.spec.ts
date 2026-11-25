import {
  ACCEPT_WINDOW_MS,
  CARD_WAIT_MS,
  CESU_GRACE_MS,
  acceptBy,
  chargeDueAt,
  methodProblem,
  requestState,
  settlementPlan,
} from './booking-request.rules';

const H = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe('booking request rules (CGV V1 5.1, 5.2, 7.3)', () => {
  describe('acceptBy', () => {
    it('gives the batch cooker 48 h from the request', () => {
      const requested = at('2026-12-01T10:00:00Z');
      expect(acceptBy(requested, at('2026-12-20T10:00:00Z'))).toEqual(
        new Date(requested.getTime() + ACCEPT_WINDOW_MS),
      );
    });

    it('cuts the delay short at the start of the session', () => {
      const starts = at('2026-12-02T08:00:00Z');
      expect(acceptBy(at('2026-12-01T10:00:00Z'), starts)).toEqual(starts);
    });
  });

  describe('requestState', () => {
    const base = {
      paymentMethod: 'cb' as const,
      status: 'pending' as const,
      cardSavedAt: null,
      requestedAt: null,
      acceptBy: null,
      acceptedAt: null,
      refusedAt: null,
    };

    it('is null for a booking of the pay-to-confirm model', () => {
      expect(requestState({ ...base, paymentMethod: null })).toBeNull();
    });

    it('waits for the card, then for the batch cooker', () => {
      expect(requestState(base)).toBe('awaiting_card');
      expect(
        requestState({
          ...base,
          cardSavedAt: at('2026-12-01T10:00:00Z'),
          requestedAt: at('2026-12-01T10:00:00Z'),
        }),
      ).toBe('awaiting_chef');
    });

    it('reads accepted, refused and expired', () => {
      expect(requestState({ ...base, status: 'confirmed', acceptedAt: new Date() })).toBe(
        'accepted',
      );
      expect(requestState({ ...base, status: 'cancelled', refusedAt: new Date() })).toBe(
        'refused',
      );
      expect(
        requestState({
          ...base,
          status: 'cancelled',
          requestedAt: at('2026-12-01T10:00:00Z'),
        }),
      ).toBe('expired');
    });
  });

  describe('chargeDueAt', () => {
    const starts = at('2026-12-10T10:00:00Z');
    const ends = at('2026-12-10T13:00:00Z');

    it('charges a card at the end of the session', () => {
      expect(chargeDueAt('cb', at('2026-12-01T10:00:00Z'), starts, ends)).toEqual(ends);
    });

    it('charges a card at acceptance when booked less than 48 h before the start', () => {
      const accepted = new Date(starts.getTime() - 47 * H);
      expect(chargeDueAt('cb', accepted, starts, ends)).toEqual(accepted);
    });

    it('never charges the advance or CESU before the end', () => {
      const accepted = new Date(starts.getTime() - 2 * H);
      expect(chargeDueAt('avance_immediate', accepted, starts, ends)).toEqual(ends);
      expect(chargeDueAt('cesu', accepted, starts, ends)).toEqual(ends);
    });
  });

  describe('methodProblem', () => {
    const offered = { cb: true, avance_immediate: true, cesu: true };

    it('refuses a method the batch cooker does not take', () => {
      expect(methodProblem('cesu', { ...offered, cesu: false }, null, false)).toBe(
        'METHOD_NOT_OFFERED',
      );
    });

    it('needs the card to be payable: it is the one every booking saves', () => {
      expect(methodProblem('cesu', { ...offered, cb: false }, null, false)).toBe(
        'CARD_NOT_AVAILABLE',
      );
    });

    it('accepts the advance with a link under review, not without a dossier or link', () => {
      expect(methodProblem('avance_immediate', offered, 'pending', false)).toBeNull();
      expect(methodProblem('avance_immediate', offered, 'active', false)).toBeNull();
      expect(methodProblem('avance_immediate', offered, 'refused', false)).toBe(
        'URSSAF_LINK_REFUSED',
      );
      expect(methodProblem('avance_immediate', offered, null, true)).toBe(
        'URSSAF_DOSSIER_MISSING',
      );
      expect(methodProblem('avance_immediate', offered, null, false)).toBe(
        'URSSAF_LINK_NONE',
      );
    });

    it('lets card and CESU through', () => {
      expect(methodProblem('cb', offered, null, false)).toBeNull();
      expect(methodProblem('cesu', offered, null, false)).toBeNull();
    });
  });

  describe('settlementPlan', () => {
    const starts = at('2026-12-10T10:00:00Z');
    const ends = at('2026-12-10T13:00:00Z');
    const base = {
      method: 'cb' as const,
      acceptedAt: at('2026-12-01T10:00:00Z'),
      startsAt: starts,
      endsAt: ends,
      remainingCents: 8400,
      waiting: false,
      urssafLinkActive: false,
    };

    it('does nothing when all is paid or a payment is under way', () => {
      expect(settlementPlan({ ...base, remainingCents: 0 }, ends)).toBe('none');
      expect(settlementPlan({ ...base, waiting: true }, ends)).toBe('none');
    });

    it('waits for the due time, then charges the card', () => {
      expect(settlementPlan(base, new Date(ends.getTime() - 1))).toBe('none');
      expect(settlementPlan(base, ends)).toBe('card');
    });

    it('sends the advance to URSSAF, or charges the card when the link never came', () => {
      expect(
        settlementPlan(
          { ...base, method: 'avance_immediate', urssafLinkActive: true },
          ends,
        ),
      ).toBe('urssaf');
      expect(settlementPlan({ ...base, method: 'avance_immediate' }, ends)).toBe('card');
    });

    it('reminds a CESU client, then charges the card 48 h after the end', () => {
      expect(settlementPlan({ ...base, method: 'cesu' }, ends)).toBe('remind_cesu');
      expect(
        settlementPlan(
          { ...base, method: 'cesu' },
          new Date(ends.getTime() + CESU_GRACE_MS),
        ),
      ).toBe('card');
    });
  });

  it('keeps an unsaved card request one hour', () => {
    expect(CARD_WAIT_MS).toBe(H);
  });
});
