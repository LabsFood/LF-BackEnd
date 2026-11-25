import { BadRequestException } from '@nestjs/common';

import { ApiValidationPipe } from '../validation.pipe';

/** The pipe exactly as `main.ts` builds it, implicit conversion included. */
export const mainPipe = () =>
  new ApiValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

export async function checkBody(body: unknown, metatype: new () => object) {
  return mainPipe().transform(body, { type: 'body', metatype });
}

/** Expects a 400 and returns the serialized error, to look the field up in it. */
export async function refusalOf(body: unknown, metatype: new () => object) {
  const error = await checkBody(body, metatype).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BadRequestException);
  return JSON.stringify((error as BadRequestException).getResponse());
}
