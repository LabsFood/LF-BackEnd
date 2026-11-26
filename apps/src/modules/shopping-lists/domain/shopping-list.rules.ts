import { HttpException, UnprocessableEntityException } from '@nestjs/common';

import { DAY_MS, parisMinute, parisToday } from '../../../common/paris-time';
import {
  shoppingListFrozen,
  shoppingListNotSent,
  shoppingListUpdated,
} from '../../dishes/domain/content.errors';
import { Line, lineKey } from '../../dishes/domain/recipes.rules';
import { roundForDisplay, unitFromText } from '../../dishes/domain/units.rules';

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
  /** « J'en ai une partie »: what they have, in the line's unit, below `qty`. */
  haveQty?: number | null;
}

/** As the client sends it: the quantity is the list's, never theirs. */
export interface MarkInput {
  name: string;
  unit: string;
  alreadyHave: boolean;
  comment?: string | null;
  haveQty?: number | null;
}

/** A line as it was sent, or as the chef has it now. */
export type ListLine = Line & { edited: boolean };

/** The batch cooker's answer to a client's comment, tied to that comment's text. */
export interface ChefReply {
  name: string;
  unit: string;
  reply: string;
  answersComment: string;
  repliedAt: Date | string;
}

export interface ReplyInput {
  name: string;
  unit: string;
  reply: string | null;
}

/** One bell per quiet spell: a change rings only after this long without one. */
export const QUIET_MS = 15 * 60 * 1000;

const validation = (message: string) =>
  new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message });

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
export function withMarks<T extends Line>(
  lines: T[],
  marks: ClientMark[],
  replies: ChefReply[] = [],
) {
  const byKey = new Map(marks.map((mark) => [lineKey(mark), mark]));
  const replyByKey = new Map(replies.map((reply) => [lineKey(reply), reply]));
  return lines.map((line) => {
    const mark = byKey.get(lineKey(line));
    const holds = mark !== undefined && mark.qty === line.qty;
    const alreadyHave = holds ? mark.alreadyHave : false;
    const comment = holds ? mark.comment : null;
    const haveQty = holds && !alreadyHave ? (mark.haveQty ?? null) : null;
    const reply = replyByKey.get(lineKey(line));
    return {
      ...line,
      alreadyHave,
      comment,
      haveQty,
      toBuyQty: alreadyHave
        ? 0
        : haveQty === null
          ? line.qty
          : roundForDisplay(line.qty - haveQty, unitFromText(line.unit) ?? line.unit),
      // A reply to an older comment must not read as a reply to the new one.
      chefReply:
        reply && comment !== null && reply.answersComment === comment
          ? { reply: reply.reply, repliedAt: reply.repliedAt }
          : null,
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
    const label = `${mark.name} (${mark.unit})`;
    if (!line) throw validation(`${label} is not on the shopping list.`);
    if (seen.has(key)) throw validation(`${label} is answered twice.`);
    if (line.providedByChef)
      throw validation(`${label} is brought by the batch cooker: nothing to tick.`);
    seen.add(key);

    let alreadyHave = mark.alreadyHave;
    let haveQty: number | null = null;
    if (!alreadyHave && mark.haveQty != null) {
      if (!(line.qty > 0)) throw validation(`${label} has no quantity to share.`);
      if (!(mark.haveQty > 0)) throw validation(`${label}: haveQty must be above 0.`);
      // All of it or more is « I already have it ».
      if (mark.haveQty >= line.qty) alreadyHave = true;
      else haveQty = mark.haveQty;
    }
    const comment = mark.comment?.trim() || null;
    if (!alreadyHave && !comment && haveQty === null) continue;
    marks.push({
      name: line.name,
      unit: line.unit,
      qty: line.qty,
      alreadyHave,
      comment,
      haveQty,
    });
  }
  return marks;
}

/**
 * A tick saved at once: the lines sent replace their mark, an empty one removes
 * it, the others keep theirs. Checked like a final list (`toMarks`).
 */
export function mergeMarks(
  lines: Line[],
  current: ClientMark[],
  input: MarkInput[],
): ClientMark[] {
  const incoming = toMarks(lines, input);
  const touched = new Set(input.map(lineKey));
  return [...current.filter((mark) => !touched.has(lineKey(mark))), ...incoming];
}

/**
 * The marks that still hold on a new version: same line, same quantity, still
 * for the client to buy. The others fall.
 */
export function keptMarks(lines: Line[], marks: ClientMark[]): ClientMark[] {
  const byKey = new Map(lines.map((line) => [lineKey(line), line]));
  return marks.filter((mark) => {
    const line = byKey.get(lineKey(mark));
    return !!line && line.qty === mark.qty && !line.providedByChef;
  });
}

const sameLine = (a: ListLine, b: ListLine) =>
  a.qty === b.qty &&
  a.aisle === b.aisle &&
  !!a.optional === !!b.optional &&
  !!a.providedByChef === !!b.providedByChef;

/** What the batch cooker changed since the last send, line by line. */
export function changesSinceSent(sent: ListLine[], live: ListLine[]) {
  const sentByKey = new Map(sent.map((line) => [lineKey(line), line]));
  const liveKeys = new Set(live.map(lineKey));
  const changes = {
    added: [] as ListLine[],
    removed: sent.filter((line) => !liveKeys.has(lineKey(line))),
    changed: [] as { before: ListLine; after: ListLine }[],
  };
  for (const line of live) {
    const before = sentByKey.get(lineKey(line));
    if (!before) changes.added.push(line);
    else if (!sameLine(before, line)) changes.changed.push({ before, after: line });
  }
  return changes;
}

/** Nothing happened for `QUIET_MS`: the next change rings. */
export const quietSince = (last: Date | null, now: Date): boolean =>
  !last || now.getTime() - last.getTime() >= QUIET_MS;

/**
 * The batch cooker's replies, merged by line: each answers the client's comment as
 * it reads now, on a line of the version sent. `null` or blank clears it.
 */
export function applyReplies(
  sent: Line[],
  marks: ClientMark[],
  current: ChefReply[],
  input: ReplyInput[],
  now: Date,
): ChefReply[] {
  const comments = new Map(
    withMarks(sent, marks).map((line) => [lineKey(line), line] as const),
  );
  const byKey = new Map(current.map((reply) => [lineKey(reply), reply]));
  for (const { name, unit, reply } of input) {
    const key = lineKey({ name, unit });
    const line = comments.get(key);
    if (!line) throw validation(`${name} (${unit}) is not on the list sent.`);
    const text = reply?.trim() || null;
    if (!text) {
      byKey.delete(key);
      continue;
    }
    if (!line.comment) throw validation(`${name} (${unit}) has no comment to answer.`);
    byKey.set(key, {
      name: line.name,
      unit: line.unit,
      reply: text,
      answersComment: line.comment,
      repliedAt: now,
    });
  }
  return [...byKey.values()];
}
