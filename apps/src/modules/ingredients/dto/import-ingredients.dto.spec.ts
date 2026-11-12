import { BadRequestException } from '@nestjs/common';

import { ApiValidationPipe } from '../../../common/validation.pipe';
import { ImportIngredientsDto } from './import-ingredients.dto';

// Same options as main.ts, implicit conversion included: it would turn "false" into true.
const pipe = new ApiValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const body = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: ImportIngredientsDto });

describe('ImportIngredientsDto (Recettes §7.4)', () => {
  it('accepts a csv alone, or with a boolean confirm', async () => {
    await expect(body({ csv: 'nom' })).resolves.toMatchObject({ csv: 'nom' });
    await expect(body({ csv: 'nom', confirm: true })).resolves.toMatchObject({
      confirm: true,
    });
    await expect(body({ csv: 'nom', confirm: false })).resolves.toMatchObject({
      confirm: false,
    });
  });

  it.each([
    ['confirm "false"', { csv: 'x', confirm: 'false' }],
    ['confirm "true"', { csv: 'x', confirm: 'true' }],
    ['confirm 1', { csv: 'x', confirm: 1 }],
    ['no csv', { confirm: true }],
    // Ruling R29: Fastify's 1 MiB body limit made 2,000,000 unreachable.
    ['a csv above 500,000 characters', { csv: 'a'.repeat(500_001) }],
    ['an unknown field', { csv: 'x', dryRun: true }],
  ])('refuses %s with a 400', async (_label, value) => {
    await expect(body(value)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a csv of exactly 500,000 characters', async () => {
    await expect(body({ csv: 'a'.repeat(500_000) })).resolves.toBeDefined();
  });
});
