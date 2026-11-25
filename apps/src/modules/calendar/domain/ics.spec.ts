import { icsCalendar, icsFold, icsText, icsUtc } from './ics';

describe('ics', () => {
  it('writes times in UTC', () => {
    expect(icsUtc(new Date('2026-10-19T07:00:00.000Z'))).toBe('20261019T070000Z');
  });

  it('escapes what TEXT values cannot hold', () => {
    expect(icsText('12 rue des Lilas, 75011 Paris; code\\B\n3e')).toBe(
      '12 rue des Lilas\\, 75011 Paris\\; code\\\\B\\n3e',
    );
  });

  it('folds at 75 octets without splitting a character', () => {
    const line = `DESCRIPTION:${'é'.repeat(60)}`;
    const folded = icsFold(line).split('\r\n');

    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(folded.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    // Unfolding gives the line back, every "é" whole.
    expect(folded.map((part, i) => (i ? part.slice(1) : part)).join('')).toBe(line);
  });

  it('builds a calendar with CRLF lines, an event without address included', () => {
    const ics = icsCalendar(
      'Lab’s Food',
      [
        {
          uid: 'b1@labsfood.fr',
          start: new Date('2026-10-19T07:00:00Z'),
          end: new Date('2026-10-19T10:00:00Z'),
          summary: 'Prestation LF-2026-0001 · Sophie M.',
          status: 'TENTATIVE',
        },
      ],
      new Date('2026-10-15T08:00:00Z'),
    );

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('\r\nDTSTART:20261019T070000Z\r\n');
    expect(ics).toContain('\r\nSTATUS:TENTATIVE\r\n');
    expect(ics).not.toContain('LOCATION');
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
