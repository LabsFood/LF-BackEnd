import {
  PairBooking,
  currentBooking,
  isContactReleased,
  isWritable,
  nextContactReleaseAt,
  shortName,
} from './messaging.rules';

const NOW = new Date('2026-10-08T10:00:00.000Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const booking = (
  status: PairBooking['status'],
  startsInHours: number,
  id = 'b1',
): PairBooking => ({
  id,
  reference: 'LF-2026-0142',
  status,
  startsAt: hours(startsInHours),
  endsAt: hours(startsInHours + 4),
});

describe('messaging rules', () => {
  describe('isContactReleased', () => {
    it('stays masked more than 48 h before a confirmed prestation', () => {
      expect(isContactReleased([booking('confirmed', 49)], NOW)).toBe(false);
    });

    it('releases from 48 h before until the prestation ends', () => {
      expect(isContactReleased([booking('confirmed', 47)], NOW)).toBe(true);
      expect(isContactReleased([booking('confirmed', -2)], NOW)).toBe(true);
    });

    it('masks again once the prestation is over', () => {
      expect(isContactReleased([booking('confirmed', -5)], NOW)).toBe(false);
      expect(isContactReleased([booking('completed', -5)], NOW)).toBe(false);
    });

    it('never releases for a booking that is not confirmed', () => {
      expect(isContactReleased([booking('pending', 10)], NOW)).toBe(false);
    });

    it.each(['shopping', 'cooking', 'delivered'] as const)(
      'keeps releasing while the prestation is %s',
      (status) => {
        expect(isContactReleased([booking(status, -1)], NOW)).toBe(true);
      },
    );
  });

  it('tells when the next release is due', () => {
    expect(nextContactReleaseAt([booking('confirmed', 72)], NOW)).toEqual(hours(24));
    expect(nextContactReleaseAt([booking('confirmed', 10)], NOW)).toBeNull();
    expect(nextContactReleaseAt([booking('pending', 72)], NOW)).toBeNull();
  });

  describe('isWritable', () => {
    it('is open while a booking is pending or confirmed', () => {
      expect(isWritable([booking('pending', 100)], NOW)).toBe(true);
      expect(isWritable([booking('confirmed', 100)], NOW)).toBe(true);
    });

    it('stays open 14 days after a completed prestation, then closes', () => {
      expect(isWritable([booking('completed', -13 * 24)], NOW)).toBe(true);
      expect(isWritable([booking('completed', -15 * 24)], NOW)).toBe(false);
    });

    it('stays open during the prestation, and 14 days after delivery', () => {
      expect(isWritable([booking('cooking', -1)], NOW)).toBe(true);
      expect(isWritable([booking('delivered', -13 * 24)], NOW)).toBe(true);
      expect(isWritable([booking('delivered', -15 * 24)], NOW)).toBe(false);
    });

    it('stays open for as long as a dispute is', () => {
      expect(isWritable([booking('disputed', -60 * 24)], NOW)).toBe(true);
    });

    it('is closed with no booking left', () => {
      expect(isWritable([], NOW)).toBe(false);
    });
  });

  it('picks the next prestation, else the latest one', () => {
    const past = booking('completed', -100, 'past');
    const next = booking('confirmed', 30, 'next');
    const later = booking('pending', 200, 'later');
    expect(currentBooking([later, past, next], NOW)?.id).toBe('next');
    expect(currentBooking([past], NOW)?.id).toBe('past');
    expect(currentBooking([], NOW)).toBeNull();
  });

  it('shortens a client name', () => {
    expect(shortName('Sophie Marchand')).toBe('Sophie M.');
    expect(shortName('Sophie')).toBe('Sophie');
    expect(shortName(null)).toBe('Client');
  });
});
