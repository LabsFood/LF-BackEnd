/**
 * Nothing a person types is trusted: every text is cleaned before it is checked,
 * and checked before it is stored. The browser's own checks are a courtesy.
 */
export const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A one-line field: no control character, no line break, spaces collapsed. */
export const oneLine = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
    : value;

/** A free text: line breaks kept, control characters and trailing blanks removed. */
export const text = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.replace(CONTROL, '').replace(/\r\n?/g, '\n').trim()
    : value;
