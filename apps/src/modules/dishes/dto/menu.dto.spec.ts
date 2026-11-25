import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ShowcaseAssignmentDto, ShowcaseRangeQueryDto } from './menu.dto';

const errorsFor = async (body: object) =>
  (await validate(plainToInstance(ShowcaseAssignmentDto, body))).map((e) => e.property);

describe('ShowcaseAssignmentDto', () => {
  it('takes a menu id or an explicit null, and refuses a missing menuId', async () => {
    const weekStart = '2026-09-28';
    expect(
      await errorsFor({ weekStart, menuId: '3a9d7f10-2c4b-4e8a-9b61-0f5e2d7c8a31' }),
    ).toEqual([]);
    expect(await errorsFor({ weekStart, menuId: null })).toEqual([]);
    expect(await errorsFor({ weekStart })).toEqual(['menuId']);
  });
});

describe('ShowcaseRangeQueryDto', () => {
  it('refuses a date that has the right shape but does not exist', async () => {
    const errors = await validate(
      plainToInstance(ShowcaseRangeQueryDto, { from: '2026-00-15', to: '2026-02-30' }),
    );
    expect(errors.map((e) => e.property)).toEqual(['from', 'to']);
    expect(
      await validate(plainToInstance(ShowcaseRangeQueryDto, { from: '2026-09-28' })),
    ).toEqual([]);
  });
});
