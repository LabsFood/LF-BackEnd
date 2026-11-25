import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BOOKING_STATUSES } from '../../bookings/domain/booking-status';

export const DELETION_OUTCOMES = ['deleted', 'anonymised'] as const;
export type DeletionOutcome = (typeof DELETION_OUTCOMES)[number];

/** Answer of `DELETE /me` and `DELETE /admin/users/:id`. */
export class DeletedUserDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The account id (`users.id`).',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  id!: string;

  @ApiProperty({
    enum: DELETION_OUTCOMES,
    description:
      '`deleted`: nothing referenced the account, it is gone. `anonymised`: past ' +
      'bookings still reference it, so it stays with its name, email and phone erased ' +
      'and the batch cooker page taken offline.',
    example: 'anonymised',
  })
  outcome!: DeletionOutcome;
}

/** A booking that stops the deletion: not completed nor cancelled yet. */
export class BlockingBookingDto {
  @ApiProperty({ format: 'uuid', example: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'BK-2026-0042' })
  reference!: string | null;

  @ApiProperty({ enum: BOOKING_STATUSES, example: 'confirmed' })
  status!: (typeof BOOKING_STATUSES)[number];

  @ApiProperty({ format: 'date-time', example: '2026-11-04T10:00:00.000Z' })
  startsAt!: Date;

  @ApiProperty({
    enum: ['client', 'chef'],
    description: 'Whether the account is the client or the batch cooker of this booking.',
    example: 'chef',
  })
  role!: 'client' | 'chef';
}

/** 409 body of a refused deletion. */
export class DeleteUserRefusedDto {
  @ApiProperty({ enum: ['USER_HAS_OPEN_BOOKINGS', 'LAST_ADMIN'] })
  code!: 'USER_HAS_OPEN_BOOKINGS' | 'LAST_ADMIN';

  @ApiProperty({
    example: 'Cancel or complete these bookings before deleting the account.',
  })
  message!: string;

  @ApiPropertyOptional({
    type: [BlockingBookingDto],
    description:
      'With `USER_HAS_OPEN_BOOKINGS` only: every booking to cancel or complete first, ' +
      'soonest first.',
  })
  bookings?: BlockingBookingDto[];

  @ApiProperty({ description: 'Joins this answer to its line in the logs.' })
  requestId!: string;
}
