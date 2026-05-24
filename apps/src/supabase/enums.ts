import { BookingStatus, UserRole } from '@prisma/client';

/** App-level aliases matching legacy `UserRole.ADMIN` style until chef-role branch. */
export const UserRoleEnum = {
  CLIENT: UserRole.client,
  PROVIDER: UserRole.provider,
  ADMIN: UserRole.admin,
} as const;

export { BookingStatus, UserRole };
