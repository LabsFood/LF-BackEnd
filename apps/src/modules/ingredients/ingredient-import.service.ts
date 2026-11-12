import { Injectable } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { aislesInForce } from '../platform-settings/recipe-lists';
import { parseIngredientCsv } from './domain/ingredient-csv.rules';
import { normalizeName } from './domain/ingredient.rules';
import { CatalogIngredientDto } from './dto/ingredient.dto';
import { PropagationResult } from './ingredient-propagation.service';
import { IngredientsService } from './ingredients.service';

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  errors: { line: number; message: string }[];
  /** Ruling R25: the entries written, to replay their propagation when `failed > 0`. */
  updatedIds: string[];
  propagation: PropagationResult;
}

type Existing = Record<string, unknown> & { id: string; normalizedName: string | null };

const asSet = (value: unknown) => [...new Set(value as unknown[])].sort();
const sameSet = (a: unknown, b: unknown) =>
  JSON.stringify(asSet(a)) === JSON.stringify(asSet(b));

/**
 * Whether the row changes the entry: the fields the row gives, as the admin routes
 * would store them (`data`, from `toWrite`), against the stored ones. Lists of other
 * names, diets and months are sets; the allergens are in annex order on both sides.
 */
function differs(data: Record<string, unknown>, stored: Existing): boolean {
  // I2: a lot 2 entry has no key yet; writing it is a change, whatever else the row says.
  if (stored.normalizedName === null) return true;
  return Object.entries(data).some(([key, value]) => {
    if (key === 'normalizedName') return false;
    if (key === 'aliases' || key === 'diets' || key === 'seasonMonths') {
      return !sameSet(value, stored[key]);
    }
    if (key === 'allergens') {
      return JSON.stringify(value) !== JSON.stringify(stored[key]);
    }
    return value !== stored[key];
  });
}

const none = (): PropagationResult => ({
  dishes: 0,
  reverified: 0,
  chefs: 0,
  skipped: 0,
  failed: 0,
});

/**
 * Recettes §7.4: the CSV import of the common ingredient list. It simulates first
 * (created, updated, unchanged, errors per line) and writes nothing when there is an
 * error. Confirmed, it writes row by row through the admin routes' own paths (an
 * update is carried into the recipes, §7.3), not in one transaction since the
 * propagation runs per dish. A write that fails stops the run: the file can be
 * replayed, the rows already written are then unchanged.
 */
@Injectable()
export class IngredientImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredients: IngredientsService,
    private readonly audit: AuditService,
  ) {}

  async run(
    text: string,
    options: { confirm: boolean },
    adminUserId: string,
  ): Promise<ImportReport> {
    const aisles = (await aislesInForce(this.prisma)).map((item) => item.code);
    const { rows, errors } = parseIngredientCsv(text, aisles);
    const plan = await this.plan(rows);
    const report: ImportReport = {
      created: plan.filter((p) => p.action === 'create').length,
      updated: plan.filter((p) => p.action === 'update').length,
      unchanged: plan.filter((p) => p.action === 'unchanged').length,
      errors,
      updatedIds: [],
      propagation: none(),
    };
    if (!options.confirm || errors.length > 0) return report;

    report.created = report.updated = report.unchanged = 0;
    try {
      for (const step of plan) {
        if (step.action === 'unchanged') {
          report.unchanged++;
        } else if (step.action === 'create') {
          await this.ingredients.create(step.row, adminUserId);
          report.created++;
        } else {
          const { propagation } = await this.ingredients.update(
            step.id,
            step.row,
            adminUserId,
          );
          report.updated++;
          report.updatedIds.push(step.id);
          if (propagation) {
            for (const key of Object.keys(
              report.propagation,
            ) as (keyof PropagationResult)[]) {
              report.propagation[key] += propagation[key];
            }
          }
        }
      }
    } catch (error) {
      // The row is named: the writes stop at it, and the file can be replayed. A
      // write error has no line of its own (blank lines are skipped in the parse).
      const row = plan[report.created + report.updated + report.unchanged]?.row;
      errors.push({
        line: 0,
        message: `${row ? `« ${row.name} »: ` : ''}${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.imported',
      subjectType: 'catalog_ingredient',
      metadata: {
        created: report.created,
        updated: report.updated,
        unchanged: report.unchanged,
        failed: errors.length > 0,
      },
    });
    return report;
  }

  /**
   * What each row would do, against the common, non-merged entries of the same name.
   * I2: a lot 2 entry whose `normalized_name` is still NULL (the reprise fills it,
   * after the import in the go-live order, spec §12) is matched by its name
   * normalized here, and updated in place rather than duplicated. A stored key wins
   * over such an entry; between two of them, the oldest.
   */
  private async plan(rows: CatalogIngredientDto[]) {
    if (rows.length === 0) return [];
    const wanted = new Set(rows.map((row) => normalizeName(row.name)));
    const stored = (await this.prisma.catalogIngredient.findMany({
      where: {
        chefProfileId: null,
        status: { not: 'merged' },
        OR: [{ normalizedName: { in: [...wanted] } }, { normalizedName: null }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as unknown as Existing[];
    const byName = new Map<string, Existing>();
    for (const entry of stored.filter((e) => e.normalizedName !== null)) {
      byName.set(entry.normalizedName as string, entry);
    }
    for (const entry of stored.filter((e) => e.normalizedName === null)) {
      const key = normalizeName(String(entry.name));
      if (wanted.has(key) && !byName.has(key)) byName.set(key, entry);
    }
    const steps: (
      | { action: 'create'; row: CatalogIngredientDto }
      | { action: 'update' | 'unchanged'; row: CatalogIngredientDto; id: string }
    )[] = [];
    for (const row of rows) {
      const entry = byName.get(normalizeName(row.name));
      if (!entry) {
        steps.push({ action: 'create', row });
        continue;
      }
      const data = (await this.ingredients.toWrite(row)) as Record<string, unknown>;
      steps.push({
        action: differs(data, entry) ? 'update' : 'unchanged',
        row,
        id: entry.id,
      });
    }
    return steps;
  }
}
