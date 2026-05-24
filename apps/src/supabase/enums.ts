import { BookingStatus, UserRole } from '../generated/prisma/client';

/** App-level aliases matching legacy `UserRole.ADMIN` style. */
export const UserRoleEnum = {
  CLIENT: UserRole.client,
  CHEF: UserRole.chef,
  ADMIN: UserRole.admin,
} as const;

export { BookingStatus, UserRole };
