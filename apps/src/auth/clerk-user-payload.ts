import type { UserJSON } from '@clerk/backend';

export interface ClerkProfileFields {
  email?: string;
  fullName?: string | null;
  phone?: string | null;
}

export function primaryEmailFromClerkUser(user: UserJSON): string | undefined {
  const addresses = user.email_addresses ?? [];
  if (addresses.length === 0) return undefined;
  const primaryId = user.primary_email_address_id;
  const primary = primaryId
    ? addresses.find((entry) => entry.id === primaryId)
    : undefined;
  return primary?.email_address ?? addresses[0]?.email_address;
}

export function primaryPhoneFromClerkUser(user: UserJSON): string | null {
  const numbers = user.phone_numbers ?? [];
  if (numbers.length === 0) return null;
  const primaryId = user.primary_phone_number_id;
  const primary = primaryId
    ? numbers.find((entry) => entry.id === primaryId)
    : undefined;
  return primary?.phone_number ?? numbers[0]?.phone_number ?? null;
}

export function fullNameFromClerkUser(user: UserJSON): string | null {
  const parts = [user.first_name, user.last_name].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Maps a Clerk UserJSON webhook payload (snake_case) to Postgres profile fields. */
export function clerkProfileFromUserJson(user: UserJSON): ClerkProfileFields {
  return {
    email: primaryEmailFromClerkUser(user),
    fullName: fullNameFromClerkUser(user),
    phone: primaryPhoneFromClerkUser(user),
  };
}

/** Maps a Clerk BAPI `users.getUser` response (camelCase) to Postgres profile fields. */
export function clerkProfileFromBapiUser(user: {
  firstName?: string | null;
  lastName?: string | null;
  emailAddresses?: ReadonlyArray<{ id: string; emailAddress: string }>;
  primaryEmailAddressId?: string | null;
  phoneNumbers?: ReadonlyArray<{ id: string; phoneNumber: string }>;
  primaryPhoneNumberId?: string | null;
}): ClerkProfileFields {
  const emails = user.emailAddresses ?? [];
  const primaryEmail = user.primaryEmailAddressId
    ? emails.find((entry) => entry.id === user.primaryEmailAddressId)
    : emails[0];

  const phones = user.phoneNumbers ?? [];
  const primaryPhone = user.primaryPhoneNumberId
    ? phones.find((entry) => entry.id === user.primaryPhoneNumberId)
    : phones[0];

  const parts = [user.firstName, user.lastName].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  return {
    email: primaryEmail?.emailAddress,
    fullName: parts.length > 0 ? parts.join(' ') : null,
    phone: primaryPhone?.phoneNumber ?? null,
  };
}
