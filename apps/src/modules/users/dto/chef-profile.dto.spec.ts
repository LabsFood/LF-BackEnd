import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateMeChefProfileDto } from './chef-profile.dto';

function validate(payload: Record<string, unknown>): string[] {
  const errors = validateSync(plainToInstance(UpdateMeChefProfileDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('UpdateMeChefProfileDto', () => {
  it('accepts languages from the list, and an empty list', () => {
    expect(validate({ languages: ['fr', 'wo'] })).toEqual([]);
    expect(validate({ languages: [] })).toEqual([]);
  });

  it.each([[['fr', 'klingon']], [['fr', 'fr']], ['fr']])(
    'refuses %j as languages',
    (languages) => {
      expect(validate({ languages })).toEqual(['languages']);
    },
  );

  it('still refuses the zones, which only an admin changes', () => {
    expect(validate({ interventionZones: [] })).toEqual(['interventionZones']);
  });
});
