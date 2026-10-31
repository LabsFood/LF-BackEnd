import { Transform } from 'class-transformer';

/**
 * A `true` / `false` query parameter. Reads the raw string: the global pipe's
 * implicit conversion has already made `"false"` into `true` (`Boolean("false")`)
 * by the time a plain `@Transform` sees `value`. Anything else is left for
 * `@IsBoolean()` to refuse.
 */
export const QueryBoolean = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    return raw === 'true' || raw === true
      ? true
      : raw === 'false' || raw === false
        ? false
        : raw;
  });
