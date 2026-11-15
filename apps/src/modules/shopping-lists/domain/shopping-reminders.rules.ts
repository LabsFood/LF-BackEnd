import { DAY_MS } from '../../../common/paris-time';
import { ListState, marksApply, shoppingDeadline } from './shopping-list.rules';

/**
 * Recettes lot 4 (LF-0285, §10.10 and §10.11): the in-app reminders of the shopping
 * list, when the batch cooker shops. Pure: the job reads the bookings, asks which
 * reminders are due, and claims each one before telling anyone.
 *
 * - the chef, from 4 days before, while the list is not sent;
 * - the client, from 2 days before, while their final list is not sent back;
 * - at the deadline (noon the day before): the client is told the list is frozen,
 *   and the chef is reminded to shop while the groceries are not confirmed.
 *
 * Each goes out once (its own timestamp on the booking), and never by e-mail.
 */
export type ReminderKind =
  'chef_send' | 'client_answer' | 'client_frozen' | 'chef_groceries';

/** The notification type each reminder creates, and who receives it. */
export const REMINDER: Record<
  ReminderKind,
  { type: string; to: 'chef' | 'client'; column: ReminderColumn }
> = {
  chef_send: {
    type: 'shopping_list.reminder_send',
    to: 'chef',
    column: 'listReminderChefAt',
  },
  client_answer: {
    type: 'shopping_list.reminder_answer',
    to: 'client',
    column: 'listReminderClientAt',
  },
  client_frozen: {
    type: 'shopping_list.frozen',
    to: 'client',
    column: 'listFrozenNotifiedAt',
  },
  chef_groceries: {
    type: 'groceries.reminder',
    to: 'chef',
    column: 'groceriesReminderAt',
  },
};

export type ReminderColumn =
  | 'listReminderChefAt'
  | 'listReminderClientAt'
  | 'listFrozenNotifiedAt'
  | 'groceriesReminderAt';

export const CHEF_SEND_DAYS = 4;
export const CLIENT_ANSWER_DAYS = 2;

/** A booking as the reminders read it. */
export interface ReminderBooking {
  startsAt: Date;
  /** Only a prestation that will take place: `confirmed` or `shopping`. */
  active: boolean;
  shoppingByClient: boolean;
  hasMeals: boolean;
  /** Null: the list was never computed, so never sent. */
  list: ListState | null;
  groceriesValidatedAt: Date | null;
  listReminderChefAt: Date | null;
  listReminderClientAt: Date | null;
  listFrozenNotifiedAt: Date | null;
  groceriesReminderAt: Date | null;
}

/** The reminders due now for one booking, none already sent. */
export function dueReminders(booking: ReminderBooking, now: Date): ReminderKind[] {
  if (!booking.active || booking.shoppingByClient || !booking.hasMeals) return [];
  const start = booking.startsAt.getTime();
  const at = now.getTime();
  if (at >= start) return [];
  const deadline = shoppingDeadline(booking.startsAt).getTime();
  const sent = (booking.list?.version ?? 0) > 0;
  const answered = !!booking.list && marksApply(booking.list);
  const due: ReminderKind[] = [];

  if (at < deadline) {
    if (!sent && !booking.listReminderChefAt && at >= start - CHEF_SEND_DAYS * DAY_MS) {
      due.push('chef_send');
    }
    if (
      sent &&
      !answered &&
      !booking.listReminderClientAt &&
      at >= start - CLIENT_ANSWER_DAYS * DAY_MS
    ) {
      due.push('client_answer');
    }
  } else {
    // The client only hears of a list they were sent.
    if (sent && !booking.listFrozenNotifiedAt) due.push('client_frozen');
    if (!booking.groceriesValidatedAt && !booking.groceriesReminderAt) {
      due.push('chef_groceries');
    }
  }
  return due;
}
