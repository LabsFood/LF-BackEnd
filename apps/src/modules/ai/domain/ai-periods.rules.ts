/**
 * Budget IA (DAT 6 bis) : les huit périodes sur lesquelles la dépense est comptée.
 * Quatre périodes fixes, en heure de Paris (jour, semaine depuis lundi 00 h, mois,
 * année), et quatre fenêtres glissantes (24 h, 7 j, 30 j, 365 j).
 */

import { DAY_MS, parisMinute, parisToday, weekdayOf } from '../../../common/paris-time';

export const FIXED_PERIODS = ['day', 'week', 'month', 'year'] as const;
export const ROLLING_PERIODS = [
  'rolling24h',
  'rolling7d',
  'rolling30d',
  'rolling365d',
] as const;
export const PERIODS = [...FIXED_PERIODS, ...ROLLING_PERIODS] as const;

export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  day: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  year: 'Cette année',
  rolling24h: '24 dernières heures',
  rolling7d: '7 derniers jours',
  rolling30d: '30 derniers jours',
  rolling365d: '365 derniers jours',
};

const ROLLING_DAYS: Record<(typeof ROLLING_PERIODS)[number], number> = {
  rolling24h: 1,
  rolling7d: 7,
  rolling30d: 30,
  rolling365d: 365,
};

const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Le début de chaque période à l'instant `now`. */
export function periodStarts(now: Date): Record<Period, Date> {
  const today = parisToday(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const monday = new Date(today.getTime() - weekdayOf(today) * DAY_MS);
  const starts = {
    day: parisMinute(today, 0),
    week: parisMinute(monday, 0),
    month: parisMinute(utcDay(y, m, 1), 0),
    year: parisMinute(utcDay(y, 0, 1), 0),
  } as Record<Period, Date>;
  for (const period of ROLLING_PERIODS) {
    starts[period] = new Date(now.getTime() - ROLLING_DAYS[period] * DAY_MS);
  }
  return starts;
}

/**
 * La clé qui distingue deux occurrences d'une période, pour n'alerter qu'une fois
 * par période : la date de début pour une période fixe, le jour de Paris pour une
 * fenêtre glissante (une alerte au plus par jour).
 */
export function periodKey(period: Period, now: Date): string {
  const start = (FIXED_PERIODS as readonly string[]).includes(period)
    ? parisToday(periodStarts(now)[period])
    : parisToday(now);
  return start.toISOString().slice(0, 10);
}
