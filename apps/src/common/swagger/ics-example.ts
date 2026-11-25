/** What a `text/calendar` answer looks like, for the routes that serve one. */
export const ICS_EXAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  "PRODID:-//Lab's Food//Agenda//FR",
  'BEGIN:VEVENT',
  'UID:booking-9c3ebc99@labsfood.fr',
  'DTSTART:20261021T070000Z',
  'DTEND:20261021T110000Z',
  'SUMMARY:Prestation LF-2026-0142',
  'LOCATION:Paris',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
