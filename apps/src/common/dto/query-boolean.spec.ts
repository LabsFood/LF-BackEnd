import { IsBoolean, IsOptional } from 'class-validator';

import { ApiValidationPipe } from '../validation.pipe';
import { QueryBoolean } from './query-boolean';

class Query {
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  flag?: boolean;
}

describe('QueryBoolean', () => {
  // As main.ts sets it up: implicit conversion turns "false" into true on its own.
  const pipe = new ApiValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const read = (flag: unknown) =>
    pipe.transform({ flag }, { type: 'query', metatype: Query }) as Promise<Query>;

  it('reads "false" as false and "true" as true', async () => {
    await expect(read('false')).resolves.toEqual({ flag: false });
    await expect(read('true')).resolves.toEqual({ flag: true });
  });

  it('refuses anything else', async () => {
    await expect(read('yes')).rejects.toMatchObject({
      response: { code: 'VALIDATION_FAILED' },
    });
  });
});
