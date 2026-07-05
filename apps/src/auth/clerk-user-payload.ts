import type { UserJSON } from '@clerk/backend';

export function primaryEmailFromClerkUser(user: UserJSON): string | undefined {
  const addresses = user.email_addresses ?? [];
  if (addresses.length === 0) return undefined;
  const primaryId = user.primary_email_address_id;
  const primary = primaryId
    ? addresses.find((entry) => entry.id === primaryId)
    : undefined;
  return primary?.email_address ?? addresses[0]?.email_address;
}

export function fullNameFromClerkUser(user: UserJSON): string | null {
  const parts = [user.first_name, user.last_name].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}
