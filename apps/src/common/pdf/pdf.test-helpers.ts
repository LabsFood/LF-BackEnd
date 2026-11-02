import { inflateSync } from 'node:zlib';

/** Shared by the PDF specs. Not a spec: never run on its own. */

/**
 * The text a reader sees, back out of the PDF. Embedded fonts print glyph ids, not
 * characters, so each `/Fn … Tf` is followed to its font's ToUnicode map, and every
 * `TJ` string decoded through the font in use. Kerning splits words inside a `TJ`
 * array, so the pieces are joined before the lines are.
 */
export function textOf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const objects = new Map<string, { dict: string; stream: string }>();
  // PDFKit always closes a stream with a bare `\nendstream`. Accepting `\r\n` there
  // would eat a compressed stream whose last byte happens to be 0x0D, and inflate fails.
  for (const [, id, dict, body] of raw.matchAll(
    /(\d+) 0 obj\s*(<<[\s\S]*?>>)\s*(?:stream\r?\n([\s\S]*?)\nendstream\s*)?endobj/g,
  )) {
    const bytes = Buffer.from(body ?? '', 'latin1');
    const stream = dict.includes('/FlateDecode') ? inflateSync(bytes) : bytes;
    objects.set(id, { dict, stream: stream.toString('latin1') });
  }

  const toUnicode = (fontId: string) => {
    const cmapId = /\/ToUnicode (\d+) 0 R/.exec(objects.get(fontId)!.dict)![1];
    const glyphs = new Map<string, string>();
    for (const [, start, list] of objects
      .get(cmapId)!
      .stream.matchAll(/<([0-9a-f]{4})> <[0-9a-f]{4}> \[([^\]]*)\]/g)) {
      [...list.matchAll(/<([0-9a-f ]+)>/g)].forEach(([, code], i) => {
        const glyph = (parseInt(start, 16) + i).toString(16).padStart(4, '0');
        const units = code.split(' ').map((unit) => parseInt(unit, 16));
        glyphs.set(glyph, String.fromCharCode(...units));
      });
    }
    return glyphs;
  };
  const fonts = new Map<string, Map<string, string>>();
  for (const { dict } of objects.values()) {
    for (const [, name, id] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      fonts.set(name, toUnicode(id));
    }
  }

  const lines: string[] = [];
  for (const { stream } of objects.values()) {
    let font: Map<string, string> | undefined;
    for (const [, name, array] of stream.matchAll(/\/(F\d+) [\d.]+ Tf|\[(.*?)\] TJ/g)) {
      if (name) {
        font = fonts.get(name);
        continue;
      }
      lines.push(
        [...array.matchAll(/<([0-9a-f]*)>/g)]
          .flatMap(([, hex]) => hex.match(/.{4}/g) ?? [])
          .map((glyph) => font!.get(glyph) ?? '�')
          .join(''),
      );
    }
  }
  return lines.join(' ');
}
