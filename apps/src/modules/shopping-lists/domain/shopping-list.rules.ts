import { HttpException, UnprocessableEntityException } from '@nestjs/common';

import { DAY_MS, parisMinute, parisToday } from '../../../common/paris-time';
import {
  shoppingListFrozen,
  shoppingListNotSent,
  shoppingListUpdated,
} from '../../dishes/domain/content.errors';
import { Line, lineKey } from '../../dishes/domain/recipes.rules';

/**
 * Recettes §10.7, case 1 (the batch cooker shops): the chef sends the list, the
 * client marks what they already have, comments a line, and sends their final
 * list back, as often as they like until the deadline. No status is stored: it
 * follows from the send count, two dates and the deadline.
 */

/** What the list row records of the exchange. `version` counts the sends. */
export interface ListState {
  version: number;
  sentAt: Date | null;
  finalReceivedAt: Date | null;
}

export type ListStatus =
  'preparing' | 'sent' | 'update_sent' | 'final_received' | 'frozen';

/** A client's answer on one line, kept with the quantity they answered. */
export interface ClientMark {
  name: string;
  unit: string;
  qty: number;
  alreadyHave: boolean;
  comment: string | null;
}

/** As the client sends it: the quantity is the list's, never theirs. */
export interface MarkInput {
  name: string;
  unit: string;
  alreadyHave: boolean;
  comment?: string | null;
}

/** Noon, Paris time, the day before the prestation. */
export const shoppingDeadline = (startsAt: Date): Date =>
  parisMinute(new Date(parisToday(startsAt).getTime() - DAY_MS), 12 * 60);

/** The client's last answer is to the list sent last. */
export const marksApply = (list: ListState): boolean =>
  !!list.sentAt && !!list.finalReceivedAt && list.finalReceivedAt >= list.sentAt;

export function listStatus(list: ListState, deadline: Date, now: Date): ListStatus {
  if (now >= deadline) return 'frozen';
  if (list.version === 0) return 'preparing';
  if (marksApply(list)) return 'final_received';
  return list.version > 1 ? 'update_sent' : 'sent';
}

/** Why the client may not send their final list now, or null. */
export function submitRefusal(
  list: ListState,
  deadline: Date,
  now: Date,
  seenVersion: number,
): HttpException | null {
  if (list.version === 0) return shoppingListNotSent();
  if (now >= deadline) return shoppingListFrozen(deadline);
  if (seenVersion !== list.version) return shoppingListUpdated(list.version);
  return null;
}

/**
 * Each line with the client's mark. A mark holds only while the line asks for the
 * quantity the client answered: "I already have it" for 200 g says nothing of 400 g.
 */
export function withMarks<T extends Line>(lines: T[], marks: ClientMark[]) {
  const byKey = new Map(marks.map((mark) => [lineKey(mark), mark]));
  return lines.map((line) => {
    const mark = byKey.get(lineKey(line));
    const holds = mark !== undefined && mark.qty === line.qty;
    return {
      ...line,
      alreadyHave: holds ? mark.alreadyHave : false,
      comment: holds ? mark.comment : null,
    };
  });
}

/**
 * The client's answer checked against the list as it is: every mark on a line of
 * it, once, with that line's quantity. A mark that says nothing is not kept.
 */
export function toMarks(lines: Line[], input: MarkInput[]): ClientMark[] {
  const byKey = new Map(lines.map((line) => [lineKey(line), line]));
  const seen = new Set<string>();
  const marks: ClientMark[] = [];
  for (const mark of input) {
    const key = lineKey(mark);
    const line = byKey.get(key);
    if (!line || seen.has(key)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: line
          ? `${mark.name} (${mark.unit}) is answered twice.`
          : `${mark.name} (${mark.unit}) is not on the shopping list.`,
      });
    }
    seen.add(key);
    const comment = mark.comment?.trim() || null;
    if (!mark.alreadyHave && !comment) continue;
    marks.push({
      name: line.name,
      unit: line.unit,
      qty: line.qty,
      alreadyHave: mark.alreadyHave,
      comment,
    });
  }
  return marks;
}
