import { Meal } from '../../generated/prisma/client';
import {
  brandDocument,
  brandHeader,
  COLOR,
  FONT,
  label,
  PAGE,
  panel,
  section,
  TEXT,
  toBuffer,
} from '../../common/pdf/brand';
import { ListItem } from '../platform-settings/recipe-lists';
import { ALLERGENS, DISH_CATEGORIES } from './domain/dishes.rules';
import { readLines } from './domain/recipe-lines.rules';
import { readSteps, STEP_TYPES } from './domain/recipes.rules';
import { displayQuantity } from './domain/units.rules';

/**
 * The recipe sheet as a PDF (Recettes §7), for the batch cooker. Every page wears
 * a LAB'S FOOD watermark. Labels, not codes: the document is printed as read.
 */
export interface RecipeDocumentInput {
  name: string;
  description: string | null;
  category: string | null;
  portions: number;
  prepMinutes: number;
  cookMinutes: number | null;
  version: number;
  ingredients: {
    name: string;
    /** Null with `to_taste`, or on a line still to verify. */
    qty: number | null;
    unit: string | null;
    fixedQuantity: boolean;
    optional: boolean;
    precision: string | null;
    preparation: string | null;
    group: string | null;
    /** The original text of a line still to verify. */
    rawText?: string | null;
  }[];
  steps: {
    order: number;
    text: string;
    type: string | null;
    durationMinutes: number | null;
  }[];
  allergens: string[];
  equipment: string[];
  storage: string | null;
  reheating: string | null;
}

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

type Ingredient = RecipeDocumentInput['ingredients'][number];

/** "2 gousses Ail, haché (bio) (facultatif) (quantité fixe)" (Recettes §7). */
function ingredientLine(line: Ingredient): string {
  // A line still to verify has no unit: its original words are all there is.
  const base =
    line.unit === null && line.rawText
      ? line.rawText
      : [line.unit === null ? null : displayQuantity(line.qty, line.unit), line.name]
          .filter(Boolean)
          .join(' ');
  return (
    base +
    (line.preparation ? `, ${line.preparation}` : '') +
    (line.precision ? ` (${line.precision})` : '') +
    (line.optional ? ' (facultatif)' : '') +
    (line.fixedQuantity ? ' (quantité fixe)' : '')
  );
}

/** A run of ingredient lines under one title, as the sheet prints it. */
export interface IngredientBlock {
  /**
   * The chef's group name as first written, or « Autres » for the lines without a
   * group; null when no line of the recipe has a group.
   */
  title: string | null;
  lines: string[];
}

const OTHERS = 'Autres';

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Each group under its name, in order of appearance, then the lines without a group
 * under « Autres » (test feedback of 26/11: printed first and untitled, they read as
 * strays, and the group names read as ingredients). A group is one group whatever its
 * case or accents (the group is typed again on every line), titled as first written.
 * A group the chef already called « Autres » takes them. A recipe with no group at all
 * is one untitled list.
 */
export function ingredientBlocks(
  lines: RecipeDocumentInput['ingredients'],
): IngredientBlock[] {
  const groups = new Map<string, IngredientBlock>();
  const ungrouped: string[] = [];
  for (const line of lines) {
    const name = line.group?.trim();
    if (!name) {
      ungrouped.push(ingredientLine(line));
      continue;
    }
    const key = fold(name);
    if (!groups.has(key)) groups.set(key, { title: name, lines: [] });
    groups.get(key)!.lines.push(ingredientLine(line));
  }

  const blocks = [...groups.values()];
  if (!ungrouped.length) return blocks;
  if (!blocks.length) return [{ title: null, lines: ungrouped }];
  const others = groups.get(fold(OTHERS));
  if (others) others.lines.push(...ungrouped);
  else blocks.push({ title: OTHERS, lines: ungrouped });
  return blocks;
}

const BULLET_INDENT = 12;
const LINE_TEXT = { ...TEXT, width: PAGE.width - BULLET_INDENT, lineGap: 2 };

/**
 * Group titles in bold navy, every line behind a bullet with a hanging indent: a long
 * line wraps under its text, not under the bullet.
 */
function writeIngredients(doc: PDFKit.PDFDocument, blocks: IngredientBlock[]) {
  doc.y += 20;
  label(doc, 'Ingrédients', COLOR.terra);
  doc.y += 5;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  blocks.forEach((block, i) => {
    if (block.title !== null) {
      if (i > 0) doc.y += 8;
      const titleHeight = doc
        .font(FONT.strong)
        .fontSize(10)
        .heightOfString(block.title, { ...TEXT, width: PAGE.width });
      const firstLine = block.lines.length
        ? doc.font(FONT.text).fontSize(9.5).heightOfString(block.lines[0], LINE_TEXT)
        : 0;
      // Never a title alone at the foot of a page: it moves with its first line.
      if (doc.y + titleHeight + 3 + firstLine > bottom()) doc.addPage();
      doc
        .font(FONT.strong)
        .fontSize(10)
        .fillColor(COLOR.navy)
        .text(block.title, PAGE.left, doc.y, { ...TEXT, width: PAGE.width });
      doc.y += 3;
    }

    doc.font(FONT.text).fontSize(9.5).fillColor(COLOR.ink);
    for (const line of block.lines) {
      if (doc.y + doc.currentLineHeight(true) > bottom()) doc.addPage();
      const y = doc.y;
      doc.text('•', PAGE.left + 2, y, { ...TEXT, lineBreak: false });
      doc.text(line, PAGE.left + BULLET_INDENT, y, LINE_TEXT);
    }
  });
  doc.x = PAGE.left;
}

export function renderRecipePdf(input: RecipeDocumentInput): Promise<Buffer> {
  const doc = brandDocument({
    Title: `Fiche recette ${input.name}`,
    Author: "Lab's Food",
    Subject: 'Fiche recette',
  });
  const done = toBuffer(doc);

  brandHeader(doc, 'Fiche recette', `Version ${input.version}`);
  doc.y = 122;
  label(doc, input.category ?? 'Recette', COLOR.terra);
  doc.y += 6;
  doc
    .font(FONT.display)
    .fontSize(24)
    .fillColor(COLOR.navy)
    .text(input.name, PAGE.left, doc.y, { ...TEXT, width: PAGE.width });
  if (input.description) {
    doc.y += 2;
    doc
      .font(FONT.text)
      .fontSize(10)
      .fillColor(COLOR.inkMid)
      .text(input.description, { ...TEXT, width: PAGE.width });
  }

  doc.y += 18;
  panel(doc, COLOR.cream, COLOR.inkSoft, [
    { label: 'Portions', value: number.format(input.portions), strong: true },
    { label: 'Préparation', value: `${input.prepMinutes} min` },
    {
      label: 'Cuisson',
      value: input.cookMinutes === null ? 'Non renseignée' : `${input.cookMinutes} min`,
    },
    {
      label: 'Allergènes',
      value: input.allergens.join(', ') || 'Aucun des 14 allergènes réglementaires',
    },
    ...(input.equipment.length
      ? [{ label: 'Matériel', value: input.equipment.join(', ') }]
      : []),
  ]);

  writeIngredients(doc, ingredientBlocks(input.ingredients));

  doc.y += 20;
  label(doc, 'Étapes', COLOR.terra);
  for (const step of input.steps) {
    doc.y += 8;
    label(
      doc,
      `${step.order}. ${step.type ?? 'Étape'}` +
        (step.durationMinutes ? ` · ${step.durationMinutes} min` : ''),
      COLOR.inkSoft,
    );
    doc.y += 3;
    doc
      .font(FONT.text)
      .fontSize(9.5)
      .fillColor(COLOR.ink)
      .text(step.text, PAGE.left, doc.y, { ...TEXT, width: PAGE.width, lineGap: 2 });
  }

  if (input.storage) section(doc, 'Conservation', input.storage);
  if (input.reheating) section(doc, 'Réchauffage', input.reheating);

  // Last, on every page, over the content: a mark too light to hide anything.
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    watermark(doc);
  }
  doc.end();
  return done;
}

function watermark(doc: PDFKit.PDFDocument) {
  doc.page.margins.bottom = 0;
  doc.save();
  doc.rotate(-35, { origin: [PAGE.left + PAGE.width / 2, PAGE.height / 2] });
  doc
    .font(FONT.display)
    .fontSize(84)
    .fillColor(COLOR.terra)
    .fillOpacity(0.08)
    .text("LAB'S FOOD", PAGE.left - 80, PAGE.height / 2 - 50, {
      ...TEXT,
      width: PAGE.width + 160,
      align: 'center',
      lineBreak: false,
    });
  doc.restore();
}

/** The batchcooking site's storage methods (lib/recipe-fields.ts). */
const STORAGE_METHODS: Record<string, string> = {
  fridge: 'Réfrigérateur',
  freezer: 'Congélateur',
  ambient: 'Température ambiante',
};

const labelOf = (list: readonly ListItem[], code: string) =>
  list.find((item) => item.code === code)?.label ?? code;

type Stored = Record<string, unknown> | null;

/** "Réfrigérateur, 3 jours, Boîte en verre": a recipe's storage, as printed. */
export function storageText(raw: unknown): string | null {
  const storage = raw as Stored;
  return storage
    ? [
        STORAGE_METHODS[String(storage.method)] ?? String(storage.method),
        typeof storage.days === 'number' ? `${storage.days} jours` : null,
        storage.container,
      ]
        .filter(Boolean)
        .join(', ')
    : null;
}

/** "Micro-ondes, 3 min. Remuer. Contenant : …": a recipe's reheating, as printed. */
export function reheatingText(
  raw: unknown,
  reheatModes: readonly ListItem[],
): string | null {
  const reheating = raw as Stored;
  const modes = Array.isArray(reheating?.modes)
    ? (reheating.modes as string[])
    : typeof reheating?.mode === 'string'
      ? [reheating.mode]
      : [];
  return reheating
    ? [
        [
          modes.map((code) => labelOf(reheatModes, code)).join(' ou '),
          typeof reheating.minutes === 'number' ? `${reheating.minutes} min` : null,
          typeof reheating.temperature === 'number'
            ? `à ${reheating.temperature} °C`
            : null,
        ]
          .filter(Boolean)
          .join(', '),
        reheating.note,
        reheating.container ? `Contenant : ${String(reheating.container)}` : null,
      ]
        .filter(Boolean)
        .join('. ')
    : null;
}

/** A dish as the sheet prints it: labels from the lists, never codes. */
export function recipeDocumentOf(
  meal: Meal,
  reheatModes: readonly ListItem[],
): RecipeDocumentInput {
  return {
    name: meal.name,
    description: meal.description,
    category: meal.category ? labelOf(DISH_CATEGORIES, meal.category) : null,
    portions: meal.portions,
    prepMinutes: meal.prepTime,
    cookMinutes: meal.cookTime,
    version: meal.recipeVersion,
    // Recettes §5.2: legacy lines read as current ones.
    ingredients: readLines(meal.ingredients),
    steps: readSteps(meal.steps).map((step) => ({
      ...step,
      type: step.type ? labelOf(STEP_TYPES, step.type) : null,
    })),
    allergens: [
      ...meal.allergens.map((code) => labelOf(ALLERGENS, code)),
      ...meal.customAllergens,
    ],
    equipment: meal.equipment,
    storage: storageText(meal.storage),
    reheating: reheatingText(meal.reheating, reheatModes),
  };
}

/** `fiche-poulet-roti-aux-herbes-v2.pdf` */
export function recipeFilename(name: string, version: number) {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `fiche-${slug || 'recette'}-v${version}.pdf`;
}
