import { IsArray, IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

import { Transform } from 'class-transformer';

import { checkBody, refusalOf } from './pipe.test-helpers';
import { oneLine } from './clean-text';
import { Raw } from './strict';

class Probe {
  @IsOptional()
  @Raw()
  @IsBoolean()
  flag?: boolean;

  @IsOptional()
  @Raw()
  @IsString()
  text?: string;

  @IsOptional()
  @Raw()
  @IsInt()
  count?: number;

  @IsOptional()
  @Raw()
  @IsArray()
  @IsString({ each: true })
  list?: string[];

  @IsOptional()
  @Raw()
  @Transform(oneLine)
  @IsString()
  clean?: string;
}

describe('Raw (keeps the value the caller sent)', () => {
  it('refuses "false" and "true" for a boolean', async () => {
    expect(await refusalOf({ flag: 'false' }, Probe)).toContain('flag');
    expect(await refusalOf({ flag: 'true' }, Probe)).toContain('flag');
  });

  it.each([{}, 123, [], true])('refuses %j for a string', async (value) => {
    expect(await refusalOf({ text: value }, Probe)).toContain('text');
  });

  it('refuses "3" for a number', async () => {
    expect(await refusalOf({ count: '3' }, Probe)).toContain('count');
  });

  it('refuses a string where a list is expected', async () => {
    expect(await refusalOf({ list: 'milk' }, Probe)).toContain('list');
  });

  it('keeps correct values, and null', async () => {
    await expect(
      checkBody(
        { flag: false, text: 'a', count: 3, list: ['milk'], clean: '  a   b ' },
        Probe,
      ),
    ).resolves.toMatchObject({
      flag: false,
      text: 'a',
      count: 3,
      list: ['milk'],
      clean: 'a b',
    });
    await expect(checkBody({ text: null }, Probe)).resolves.toBeDefined();
  });
});
