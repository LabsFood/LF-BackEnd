import { canReschedule, decisionRefusal, rescheduleExpiry } from './reschedule.rules';

const NOW = new Date('2030-03-10T12:00:00Z');
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('canReschedule', () => {
  it('lets a confirmed booking more than 48 h away move to a time more than 48 h away', () => {
    expect(canReschedule('confirmed', hoursAhead(49), hoursAhead(72), NOW)).toBe(true);
  });

  it('freezes the last 48 h, before and after the move', () => {
    expect(canReschedule('confirmed', hoursAhead(47), hoursAhead(72), NOW)).toBe(false);
    expect(canReschedule('confirmed', hoursAhead(72), hoursAhead(47), NOW)).toBe(false);
  });

  it('only moves a confirmed booking', () => {
    for (const status of ['pending', 'shopping', 'cancelled', 'disputed'] as const) {
      expect(canReschedule(status, hoursAhead(100), hoursAhead(120), NOW)).toBe(false);
    }
  });
});

describe('rescheduleExpiry', () => {
  it('gives 48 h, cut short to 48 h before the start', () => {
    expect(rescheduleExpiry(NOW, hoursAhead(7 * 24))).toEqual(hoursAhead(48));
    expect(rescheduleExpiry(NOW, hoursAhead(60))).toEqual(hoursAhead(12));
  });
});

describe('decisionRefusal', () => {
  it('lets the other side confirm or decline, and the proposer withdraw', () => {
    expect(decisionRefusal('client', 'chef', 'accepted')).toBeNull();
    expect(decisionRefusal('chef', 'client', 'declined')).toBeNull();
    expect(decisionRefusal('chef', 'chef', 'withdrawn')).toBeNull();
  });

  it('refuses a proposer confirming their own, or withdrawing the other’s', () => {
    expect(decisionRefusal('chef', 'chef', 'accepted')).toBe('RESCHEDULE_OWN_PROPOSAL');
    expect(decisionRefusal('client', 'chef', 'withdrawn')).toBe('RESCHEDULE_NOT_YOURS');
  });
});
