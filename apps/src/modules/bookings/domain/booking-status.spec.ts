import { BookingActor, canTransition } from './booking-status';
import type { BookingStatus } from '../../../generated/prisma/client';

describe('canTransition', () => {
  it.each<[BookingActor, BookingStatus, BookingStatus]>([
    ['client', 'pending', 'cancelled'],
    ['chef', 'pending', 'cancelled'],
    ['client', 'confirmed', 'cancelled'],
    ['chef', 'confirmed', 'cancelled'],
    ['chef', 'confirmed', 'shopping'],
    ['chef', 'confirmed', 'cooking'],
    ['chef', 'shopping', 'cooking'],
    ['chef', 'cooking', 'delivered'],
    ['client', 'delivered', 'completed'],
    ['chef', 'delivered', 'completed'],
    ['admin', 'pending', 'confirmed'],
    ['admin', 'cancelled', 'confirmed'],
    // A dispute is opened and closed by an admin.
    ['admin', 'completed', 'disputed'],
    ['admin', 'confirmed', 'disputed'],
    ['admin', 'disputed', 'completed'],
    ['admin', 'disputed', 'cancelled'],
  ])('lets the %s move %s → %s', (actor, from, to) => {
    expect(canTransition(actor, from, to)).toBe(true);
  });

  it.each<[BookingActor, BookingStatus, BookingStatus]>([
    // Payment confirms a booking, never a PATCH.
    ['client', 'pending', 'confirmed'],
    ['chef', 'pending', 'confirmed'],
    // Only the batch cooker runs the prestation.
    ['client', 'confirmed', 'shopping'],
    ['client', 'shopping', 'cooking'],
    ['client', 'cooking', 'delivered'],
    // No skipping ahead, no going back, nothing after the end.
    ['chef', 'pending', 'cooking'],
    ['chef', 'confirmed', 'delivered'],
    ['chef', 'cooking', 'confirmed'],
    ['chef', 'shopping', 'cancelled'],
    ['client', 'completed', 'cancelled'],
    ['chef', 'cancelled', 'pending'],
    ['admin', 'confirmed', 'confirmed'],
    // Clients and batch cookers report a dispute to support; they never set it.
    ['client', 'delivered', 'disputed'],
    ['chef', 'completed', 'disputed'],
    ['client', 'disputed', 'completed'],
    ['chef', 'disputed', 'cancelled'],
    // Nothing to dispute in a prestation that never happened.
    ['admin', 'cancelled', 'disputed'],
  ])('refuses the %s %s → %s', (actor, from, to) => {
    expect(canTransition(actor, from, to)).toBe(false);
  });
});
