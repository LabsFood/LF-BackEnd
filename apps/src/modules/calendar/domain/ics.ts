/**
 * iCalendar (RFC 5545) as pure functions: what Google, Outlook and Apple read from
 * a subscribed feed or a downloaded file. Times in UTC, lines folded at 75 octets
 * and joined with CRLF, text escaped. No dependency.
 */

export interface IcsEvent {
  /** Stable across fetches: the calendar app updates the event instead of adding one. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

/** `20261015T081500Z`. */
export const icsUtc = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Backslash, semicolon, comma and newlines, as TEXT values need. */
export const icsText = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/**
 * Lines longer than 75 octets go on, after CRLF, on lines starting with a space.
 * Counted in UTF-8 bytes, never splitting a character: "é" is two.
 */
export function icsFold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function icsCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Lab's Food//Agenda//FR",
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    // A hint to poll hourly; each app picks its own pace.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsUtc(event.start)}`,
      `DTEND:${icsUtc(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`,
      ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      `STATUS:${event.status ?? 'CONFIRMED'}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
