import { checkBody, refusalOf } from '../../common/dto/pipe.test-helpers';
import { AislesDto } from './platform-settings.controller';

const item = (n: number) => ({ code: `aisle-${n}`, label: `Rayon ${n}` });
const many = (n: number) => Array.from({ length: n }, (_, i) => item(i));

describe('AislesDto (PUT /admin/settings/aisles)', () => {
  it('accepts 1 and 30 items', async () => {
    await expect(checkBody({ aisles: many(1) }, AislesDto)).resolves.toBeDefined();
    await expect(checkBody({ aisles: many(30) }, AislesDto)).resolves.toBeDefined();
  });

  it('refuses 0 items and 31 items', async () => {
    expect(await refusalOf({ aisles: [] }, AislesDto)).toContain('aisles');
    expect(await refusalOf({ aisles: many(31) }, AislesDto)).toContain('aisles');
  });

  it('refuses a missing or non-array list', async () => {
    expect(await refusalOf({}, AislesDto)).toContain('aisles');
    expect(await refusalOf({ aisles: 'fruits' }, AislesDto)).toContain('aisles');
  });

  it.each(['', '   ', 'Bad Code', 'UPPER', 'a'.repeat(41), 12, {}, null])(
    'refuses code = %j',
    async (code) => {
      expect(
        await refusalOf({ aisles: [{ code, label: 'Rayon' }] }, AislesDto),
      ).toContain('code');
    },
  );

  it.each(['', '   ', 'a'.repeat(61), 12, {}, ['x'], null])(
    'refuses label = %j',
    async (label) => {
      expect(await refusalOf({ aisles: [{ code: 'ok', label }] }, AislesDto)).toContain(
        'label',
      );
    },
  );

  it('refuses an unknown field, on the list and on an item', async () => {
    expect(await refusalOf({ aisles: many(1), extra: 1 }, AislesDto)).toContain('extra');
    expect(
      await refusalOf(
        { aisles: [{ code: 'ok', label: 'Rayon', color: 'red' }] },
        AislesDto,
      ),
    ).toContain('color');
  });
});
