import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min, ValidateNested } from 'class-validator';

import { ApiValidationPipe } from './validation.pipe';

class Line {
  @IsInt()
  @Min(1)
  portions!: number;
}

class Body {
  @IsString()
  @Length(14, 14)
  siret!: string;

  @ValidateNested({ each: true })
  @Type(() => Line)
  meals!: Line[];
}

describe('ApiValidationPipe', () => {
  const pipe = new ApiValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('keeps Nest’s 400 and adds one entry per failed field', async () => {
    const error = await pipe
      .transform(
        { siret: '123', meals: [{ portions: 0 }], extra: true },
        { type: 'body', metatype: Body },
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    // The sentences the front already reads are unchanged.
    expect(body.message).toEqual(
      expect.arrayContaining([
        'siret must be longer than or equal to 14 characters',
        'meals.0.portions must not be less than 1',
        'property extra should not exist',
      ]),
    );
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'siret', code: 'isLength' }),
        expect.objectContaining({ field: 'meals.0.portions', code: 'min' }),
        expect.objectContaining({ field: 'extra', code: 'whitelistValidation' }),
      ]),
    );
  });
});
