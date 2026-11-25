import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SubmitContactMessageDto } from './contact.dto';

const VALID = {
  source: 'labsfood',
  name: 'Sophie Marchand',
  email: 'sophie@exemple.fr',
  message: 'Bonjour, intervenez-vous à Nice ?',
};

/** The names of the fields the form would be told are wrong. */
async function invalidFields(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(SubmitContactMessageDto, body));
  return errors.map((e) => e.property);
}

describe('SubmitContactMessageDto', () => {
  it('accepts the form with only its required fields', async () => {
    expect(await invalidFields(VALID)).toEqual([]);
  });

  it('trims before validating', async () => {
    const dto = plainToInstance(SubmitContactMessageDto, {
      ...VALID,
      name: '  Sophie  ',
      message: '   Bonjour à tous   ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Sophie');
  });

  it.each([
    ['name', 'A'],
    ['name', '12345'],
    ['name', '   '],
    ['email', 'sophie@'],
    ['email', 'pas un email'],
    ['message', 'court'],
    ['message', '          '],
    ['message', 'x'.repeat(5001)],
    ['source', 'ailleurs'],
  ])('refuses %s = %p', async (field, value) => {
    expect(await invalidFields({ ...VALID, [field]: value })).toEqual([field]);
  });

  it.each([
    '06 12 34 56 78',
    '+33 6 12 34 56 78',
    '0612345678',
    '06.12.34.56.78',
    '+34 (612) 345-678',
  ])('accepts the phone number %p', async (phone) => {
    expect(await invalidFields({ ...VALID, phone })).toEqual([]);
  });

  it.each(['12345', 'appelez-moi', '06 12 34 56 78 poste 4', '1'.repeat(16)])(
    'refuses the phone number %p',
    async (phone) => {
      expect(await invalidFields({ ...VALID, phone })).toEqual(['phone']);
    },
  );
});
