/**
 * Recettes §7.4: the CSV import of the common ingredient list. Pure: text in, rows
 * and per-line errors out. Separator `;`, lists inside a cell separated by `|`,
 * booleans `oui` / `non`, double-quoted cells (`""` escapes a quote).
 */

import { CONTROL } from '../../../common/dto/clean-text';
import { ALLERGEN_CODES, COMPUTED_DIET_CODES } from '../../dishes/domain/dishes.rules';
import { CatalogIngredientDto } from '../dto/ingredient.dto';
import { normalizeName } from './ingredient.rules';

export const IMPORT_MAX_LINES = 2000;

/** `doute` holds the reviewer's notes: it must be present, and is never imported. */
export const CSV_COLUMNS = [
  'nom',
  'autres_noms',
  'rayon',
  'allergenes',
  'aucun_allergene',
  'regimes',
  'mois',
  'base',
  'doute',
] as const;

export interface CsvLineError {
  line: number;
  message: string;
}

interface Record_ {
  line: number;
  cells: string[];
}

/** Splits the text into records (a quoted cell may hold the separator or a line break). */
function records(text: string): Record_[] {
  const out: Record_[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    cells.push(cell);
    if (cells.length > 1 || cells[0].trim() !== '') out.push({ line: start, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === ';') {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      cell += c;
    }
  }
  endRecord();
  return out;
}

const clean = (value: string) => value.replace(CONTROL, '').replace(/\s+/g, ' ').trim();

const list = (cell: string) =>
  cell
    .split('|')
    .map(clean)
    .filter((item) => item !== '');

/** `oui` / `non`, any case; an empty cell is "not given" (undefined). */
function bool(cell: string, column: string): boolean | undefined {
  const value = clean(cell).toLowerCase();
  if (value === '') return undefined;
  if (value === 'oui') return true;
  if (value === 'non') return false;
  throw new Error(`${column}: « ${clean(cell)} » n’est ni oui ni non.`);
}

function row(cells: Record<string, string>, aisles: string[]): CatalogIngredientDto {
  const name = clean(cells.nom);
  if (name.length < 1 || name.length > 120) {
    throw new Error('nom: 1 à 120 caractères.');
  }
  const dto: CatalogIngredientDto = { name };

  const aliases = list(cells.autres_noms);
  if (aliases.length > 20) throw new Error('autres_noms: 20 au plus.');
  if (aliases.some((alias) => alias.length > 120)) {
    throw new Error('autres_noms: 120 caractères au plus chacun.');
  }
  if (aliases.length) dto.aliases = aliases;

  const aisle = clean(cells.rayon);
  if (aisle) {
    if (!aisles.includes(aisle))
      throw new Error(`rayon: « ${aisle} » n’est pas dans la liste.`);
    dto.aisle = aisle;
  }

  const allergens = list(cells.allergenes).map((code) => code.toLowerCase());
  const unknownAllergen = allergens.find((code) => !ALLERGEN_CODES.includes(code));
  if (unknownAllergen) throw new Error(`allergenes: « ${unknownAllergen} » est inconnu.`);
  const repeatedAllergen = allergens.find((code, i) => allergens.indexOf(code) !== i);
  if (repeatedAllergen)
    throw new Error(`allergenes: « ${repeatedAllergen} » est en double.`);
  const none = bool(cells.aucun_allergene, 'aucun_allergene');
  if (none && allergens.length) {
    throw new Error('aucun_allergene: oui ne va pas avec des allergènes listés.');
  }
  if (!none && allergens.length === 0) {
    throw new Error('allergenes: des allergènes, ou aucun_allergene à oui.');
  }
  if (allergens.length) dto.allergens = allergens;
  if (none) dto.allergensNone = true;

  const diets = list(cells.regimes).map((code) => code.toLowerCase());
  const unknownDiet = diets.find((code) => !COMPUTED_DIET_CODES.includes(code));
  if (unknownDiet) throw new Error(`regimes: « ${unknownDiet} » est inconnu.`);
  if (diets.length) dto.diets = [...new Set(diets)];

  const months = list(cells.mois).map((item) => {
    if (!/^\d+$/.test(item) || +item < 1 || +item > 12) {
      throw new Error(`mois: « ${item} » n’est pas un entier de 1 à 12.`);
    }
    return Number(item);
  });
  const repeatedMonth = months.find((month, i) => months.indexOf(month) !== i);
  if (repeatedMonth !== undefined)
    throw new Error(`mois: « ${repeatedMonth} » est en double.`);
  if (months.length) dto.seasonMonths = months;

  const basic = bool(cells.base, 'base');
  if (basic !== undefined) dto.isBasic = basic;
  return dto;
}

/**
 * Recettes §7.4: every data line becomes an entry or one error (line numbers 1-based,
 * the header is line 1). A missing or unknown column is one error at line 1; more
 * than 2,000 data lines is one error and no row.
 */
export function parseIngredientCsv(
  text: string,
  aisles: string[],
): { rows: CatalogIngredientDto[]; errors: CsvLineError[] } {
  const all = records(text.replace(/^﻿/, ''));
  if (all.length === 0) {
    return { rows: [], errors: [{ line: 1, message: 'Le fichier est vide.' }] };
  }
  const header = all[0].cells.map((cell) => clean(cell).toLowerCase());
  const missing = CSV_COLUMNS.filter((column) => !header.includes(column));
  const extra = header.filter(
    (column, i) =>
      !(CSV_COLUMNS as readonly string[]).includes(column) ||
      header.indexOf(column) !== i,
  );
  if (missing.length || extra.length) {
    const parts = [
      missing.length && `colonnes manquantes: ${missing.join(', ')}`,
      extra.length && `colonnes inconnues ou en double: ${extra.join(', ')}`,
    ].filter(Boolean);
    return { rows: [], errors: [{ line: 1, message: `En-tête: ${parts.join(' ; ')}.` }] };
  }

  const data = all.slice(1);
  if (data.length > IMPORT_MAX_LINES) {
    return {
      rows: [],
      errors: [
        {
          line: data[IMPORT_MAX_LINES].line,
          message: `Au plus ${IMPORT_MAX_LINES} lignes d’ingrédients.`,
        },
      ],
    };
  }

  const rows: CatalogIngredientDto[] = [];
  const errors: CsvLineError[] = [];
  const seen = new Set<string>();
  for (const record of data) {
    try {
      if (record.cells.length !== header.length) {
        throw new Error(`${record.cells.length} colonnes au lieu de ${header.length}.`);
      }
      const cells = Object.fromEntries(
        header.map((column, i) => [column, record.cells[i]]),
      );
      const entry = row(cells, aisles);
      const key = normalizeName(entry.name);
      if (seen.has(key))
        throw new Error(`nom: « ${entry.name} » est déjà dans le fichier.`);
      seen.add(key);
      rows.push(entry);
    } catch (error) {
      errors.push({ line: record.line, message: (error as Error).message });
    }
  }
  return { rows, errors };
}
