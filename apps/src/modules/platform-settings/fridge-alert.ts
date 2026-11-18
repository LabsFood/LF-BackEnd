import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_FRIDGE_ALERT_DAYS } from '../bookings/domain/eat-before.rules';

/**
 * Recettes lot 3 (LF-0271): past this many days in the fridge, a dish's « à manger
 * avant » date raises an alert (never a block). 4 by default (PRD), editable in the
 * console until the hygiene referent confirms a value (BLK-31).
 */
export const FRIDGE_ALERT_KEY = 'fridge_alert_days';

export const FRIDGE_ALERT_MIN = 1;
export const FRIDGE_ALERT_MAX = 14;

type Db = Pick<PrismaService, 'platformSetting'>;

/** The threshold in force: the admin's value, or the default when never set. */
export async function fridgeAlertDaysInForce(db: Db): Promise<number> {
  const row = await db.platformSetting.findUnique({ where: { key: FRIDGE_ALERT_KEY } });
  const days = (row?.value as { days?: unknown } | null)?.days;
  return typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= FRIDGE_ALERT_MIN &&
    days <= FRIDGE_ALERT_MAX
    ? days
    : DEFAULT_FRIDGE_ALERT_DAYS;
}
