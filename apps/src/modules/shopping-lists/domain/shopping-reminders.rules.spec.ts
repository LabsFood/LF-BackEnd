import { dueReminders, ReminderBooking } from './shopping-reminders.rules';

describe('shopping list reminders (Recettes lot 4, LF-0285)', () => {
  // Friday 20/11 at 09:00 in Paris: the list freezes Thursday 19/11 at noon.
  const startsAt = new Date('2026-11-20T08:00:00.000Z');
  const booking = (over: Partial<ReminderBooking> = {}): ReminderBooking => ({
    startsAt,
    active: true,
    shoppingByClient: false,
    hasMeals: true,
    list: null,
    groceriesValidatedAt: null,
    listReminderChefAt: null,
    listReminderClientAt: null,
    listFrozenNotifiedAt: null,
    groceriesReminderAt: null,
    ...over,
  });
  const sentAt = new Date('2026-11-15T10:00:00.000Z');
  const sent = { version: 1, sentAt, finalReceivedAt: null };
  const at = (iso: string) => new Date(iso);

  it('reminds the chef from 4 days before, while the list is not sent', () => {
    expect(dueReminders(booking(), at('2026-11-16T07:59:00.000Z'))).toEqual([]);
    expect(dueReminders(booking(), at('2026-11-16T08:00:00.000Z'))).toEqual([
      'chef_send',
    ]);
    expect(dueReminders(booking({ list: sent }), at('2026-11-16T09:00:00.000Z'))).toEqual(
      [],
    );
  });

  it('reminds the client from 2 days before, while their final list is not back', () => {
    expect(dueReminders(booking({ list: sent }), at('2026-11-18T08:00:00.000Z'))).toEqual(
      ['client_answer'],
    );
    const answered = { ...sent, finalReceivedAt: at('2026-11-17T10:00:00.000Z') };
    expect(
      dueReminders(booking({ list: answered }), at('2026-11-18T09:00:00.000Z')),
    ).toEqual([]);
  });

  it('at the deadline tells the client the list is frozen and the chef to shop', () => {
    expect(dueReminders(booking({ list: sent }), at('2026-11-19T11:00:00.000Z'))).toEqual(
      ['client_frozen', 'chef_groceries'],
    );
    // A list never sent: the client has nothing frozen to hear of.
    expect(dueReminders(booking(), at('2026-11-19T11:00:00.000Z'))).toEqual([
      'chef_groceries',
    ]);
  });

  it('sends each reminder once, and none once the groceries are confirmed', () => {
    expect(
      dueReminders(
        booking({
          list: sent,
          listFrozenNotifiedAt: at('2026-11-19T11:00:00.000Z'),
          groceriesValidatedAt: at('2026-11-19T15:00:00.000Z'),
        }),
        at('2026-11-19T16:00:00.000Z'),
      ),
    ).toEqual([]);
    expect(
      dueReminders(
        booking({ listReminderChefAt: at('2026-11-16T08:00:00.000Z') }),
        at('2026-11-17T08:00:00.000Z'),
      ),
    ).toEqual([]);
  });

  it('says nothing when the client shops, without dishes, off course or once started', () => {
    const late = at('2026-11-19T11:00:00.000Z');
    expect(dueReminders(booking({ shoppingByClient: true }), late)).toEqual([]);
    expect(dueReminders(booking({ hasMeals: false }), late)).toEqual([]);
    expect(dueReminders(booking({ active: false }), late)).toEqual([]);
    expect(dueReminders(booking(), at('2026-11-20T08:00:00.000Z'))).toEqual([]);
  });
});
