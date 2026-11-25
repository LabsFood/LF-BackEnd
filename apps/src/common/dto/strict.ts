import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

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

/**
 * An optional body field that may be left out, never sent as `null`. `@IsOptional()`
 * skips the validators for `null` too, so a `null` reached the service and failed
 * there (500). Use this in its place on a field `null` does not clear: the
 * validators then run on `null` and answer 400.
 *
 * A `PartialType` of a class using it must pass `{ skipNullProperties: false }`, or
 * it adds `@IsOptional()` back on every field.
 */
export const OptionalNotNull = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);
