import { BadRequestException } from '@nestjs/common';

import { ParseVersionPipe } from './version-param.pipe';

describe('ParseVersionPipe', () => {
  const pipe = new ParseVersionPipe();

  it.each([
    ['1', 1],
    ['42', 42],
    ['2147483647', 2147483647],
  ])('accepts %s', (raw, expected) => {
    expect(pipe.transform(raw)).toBe(expected);
  });

  it.each([
    '0',
    '-1',
    '2147483648',
    '99999999999999999999',
    '1.5',
    'abc',
    '',
    '1e3',
    ' 2',
  ])('answers 400 for %j', (raw) => {
    expect(() => pipe.transform(raw)).toThrow(BadRequestException);
  });
});
