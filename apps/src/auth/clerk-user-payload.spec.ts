import {
  clerkProfileFromBapiUser,
  clerkProfileFromUserJson,
  fullNameFromClerkUser,
  primaryEmailFromClerkUser,
  primaryPhoneFromClerkUser,
} from './clerk-user-payload';

describe('clerk-user-payload', () => {
  const baseUser = {
    id: 'user_1',
    first_name: 'Marie',
    last_name: 'Curie',
    email_addresses: [
      { id: 'em_1', email_address: 'marie@example.com' },
      { id: 'em_2', email_address: 'secondary@example.com' },
    ],
    primary_email_address_id: 'em_1',
    phone_numbers: [
      { id: 'ph_1', phone_number: '+33601020304' },
      { id: 'ph_2', phone_number: '+33605060708' },
    ],
    primary_phone_number_id: 'ph_1',
  } as never;

  it('extracts primary email', () => {
    expect(primaryEmailFromClerkUser(baseUser)).toBe('marie@example.com');
  });

  it('extracts full name', () => {
    expect(fullNameFromClerkUser(baseUser)).toBe('Marie Curie');
  });

  it('extracts primary phone', () => {
    expect(primaryPhoneFromClerkUser(baseUser)).toBe('+33601020304');
  });

  it('maps UserJSON to profile fields', () => {
    expect(clerkProfileFromUserJson(baseUser)).toEqual({
      email: 'marie@example.com',
      fullName: 'Marie Curie',
      phone: '+33601020304',
    });
  });

  it('maps BAPI user to profile fields', () => {
    expect(
      clerkProfileFromBapiUser({
        firstName: 'Marie',
        lastName: 'Curie',
        emailAddresses: [{ id: 'em_1', emailAddress: 'marie@example.com' }],
        primaryEmailAddressId: 'em_1',
        phoneNumbers: [{ id: 'ph_1', phoneNumber: '+33601020304' }],
        primaryPhoneNumberId: 'ph_1',
      }),
    ).toEqual({
      email: 'marie@example.com',
      fullName: 'Marie Curie',
      phone: '+33601020304',
    });
  });
});
