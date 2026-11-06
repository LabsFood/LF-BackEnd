import { Transform } from 'class-transformer';

/**
 * Keeps the value the caller sent. `main.ts` turns on `enableImplicitConversion`
 * (query parameters rely on it), which would otherwise make `"false"` into `true`,
 * an object into `"[object Object]"` and `"3"` into `3` before the validators run.
 * Use it on body fields, next to `@IsBoolean()`, `@IsString()`, `@IsInt()`, …; never
 * on a query parameter, which is a string by nature.
 *
 * Put it above any cleaning `@Transform` (such as `oneLine`) and the validators: the
 * topmost transform runs first, so the cleaning one then works on the raw value.
 */
export const Raw = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key]);
