import { periodKey, periodStarts } from './ai-periods.rules';

describe('periodStarts', () => {
  it('compte en heure de Paris : jour, lundi 00 h, 1er du mois, 1er janvier', () => {
    // Mercredi 18 novembre 2026, 10 h à Paris (UTC+1).
    const starts = periodStarts(new Date('2026-11-18T09:00:00Z'));
    expect(starts.day.toISOString()).toBe('2026-11-17T23:00:00.000Z');
    expect(starts.week.toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(starts.month.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(starts.year.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(starts.rolling24h.toISOString()).toBe('2026-11-17T09:00:00.000Z');
    expect(starts.rolling365d.toISOString()).toBe('2025-11-18T09:00:00.000Z');
  });

  it('prend le jour de Paris juste après minuit, même si UTC est encore la veille', () => {
    const starts = periodStarts(new Date('2026-11-22T23:30:00Z')); // lundi 23/11 00 h 30 à Paris
    expect(starts.day.toISOString()).toBe('2026-11-22T23:00:00.000Z');
    expect(starts.week.toISOString()).toBe('2026-11-22T23:00:00.000Z');
  });

  it("suit le changement d'heure : le mois d'avril commence à 22 h UTC", () => {
    const starts = periodStarts(new Date('2027-04-10T12:00:00Z'));
    expect(starts.month.toISOString()).toBe('2027-03-31T22:00:00.000Z');
    expect(starts.year.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  it('passe à la nouvelle année à minuit à Paris', () => {
    const starts = periodStarts(new Date('2026-12-31T23:10:00Z'));
    expect(starts.year.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});

describe('periodKey', () => {
  it('donne le début pour une période fixe et le jour pour une fenêtre glissante', () => {
    const now = new Date('2026-11-18T09:00:00Z');
    expect(periodKey('month', now)).toBe('2026-11-01');
    expect(periodKey('week', now)).toBe('2026-11-16');
    expect(periodKey('rolling30d', now)).toBe('2026-11-18');
  });
});
