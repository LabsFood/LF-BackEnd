import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGateway, type AiRoute } from '../ai/ai-gateway.service';
import { recipeImportInForce } from '../ai/ai-settings';
import { matchIndex } from '../dishes/domain/reprise.rules';
import { aislesInForce } from '../platform-settings/recipe-lists';
import {
  IngredientPropagationService,
  type ChefsToTell,
  type PropagationResult,
} from './ingredient-propagation.service';
import {
  ENRICH_BATCH,
  enrichmentPrompt,
  enrichmentSchema,
  ENRICHMENT_SCHEMA_NAME,
  missingFieldsPatch,
  parseEnrichment,
  toEnriched,
  type EnrichedIngredient,
} from './domain/ingredient-enrichment.rules';
import { matchKey, normalizeName } from './domain/ingredient.rules';
import { IngredientsService } from './ingredients.service';

const SMALL: AiRoute = { provider: 'mistral', model: 'mistral-small-latest' };
const HAIKU: AiRoute = {
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  effort: 'low',
};

/** Chez un cuisinier : ses fiches privées, comptées comme s'il les créait (§7.1). */
const CHEF_DAILY_CAP = 50;
/**
 * Rattrapage : fiches traitées par appel, un lot d'IA, pour rester sous le délai
 * d'une requête de la console ; la console enchaîne les appels jusqu'au bout.
 */
export const COMPLETE_MAX = 20;

/** À qui appartiennent les fiches créées depuis un import. */
export type SheetOwner =
  | { kind: 'admin'; userId: string }
  | { kind: 'chef'; chefProfileId: string; userId: string };

export interface CreatedSheets {
  /** Nom lu (minuscules) → fiche à relier. */
  links: Map<string, string>;
  created: { id: string; name: string }[];
  /** Noms laissés sans fiche : écartés par l'IA, sans réponse lisible, ou plafond. */
  skipped: string[];
  /** Parmi eux, ce que l'IA juge ne pas être un ingrédient (« échalote et ail »). */
  notIngredients: string[];
  costMicroEur: number;
}

/**
 * Les fiches d'ingrédients remplies par l'IA (rayon, allergènes, régimes, saisons,
 * « de base »). Un ingrédient inconnu lu dans un import devient une fiche complète,
 * reliée aussitôt ; une fiche existante sans rayon ou sans allergènes est complétée,
 * champs vides seulement. Toute fiche touchée reste « non revue » pour l'admin.
 */
@Injectable()
export class IngredientEnrichmentService {
  private readonly logger = new Logger(IngredientEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly ingredients: IngredientsService,
    private readonly propagation: IngredientPropagationService,
    private readonly audit: AuditService,
  ) {}

  /** Une fiche par nom, par lots ; un lot en échec est laissé de côté (jamais levé). */
  async sheets(
    names: string[],
    context: { chefProfileId?: string | null; tag: string },
  ): Promise<{ sheets: EnrichedIngredient[]; costMicroEur: number }> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (unique.length === 0) return { sheets: [], costMicroEur: 0 };
    const aisles = await aislesInForce(this.prisma);
    const settings = await recipeImportInForce(this.prisma);
    const routes = settings.allowNonEuFallback ? [SMALL, HAIKU] : [SMALL];
    const sheets: EnrichedIngredient[] = [];
    let costMicroEur = 0;
    for (let i = 0; i < unique.length; i += ENRICH_BATCH) {
      const batch = unique.slice(i, i + ENRICH_BATCH);
      try {
        const result = await this.gateway.run({
          labels: { poste: 'recettes', feature: 'fiche_ingredient', tags: [context.tag] },
          chefProfileId: context.chefProfileId ?? null,
          system: enrichmentPrompt(aisles),
          content: [{ type: 'text', text: batch.map((n) => `- ${n}`).join('\n') }],
          schema: enrichmentSchema(aisles),
          schemaName: ENRICHMENT_SCHEMA_NAME,
          routes,
          parse: parseEnrichment,
          accept: (data) => data.ingredients.length >= batch.length,
        });
        costMicroEur += result.costMicroEur;
        sheets.push(
          ...toEnriched(
            batch,
            result.data.ingredients,
            aisles.map((a) => a.code),
          ),
        );
      } catch (error) {
        // Budget atteint, fournisseur indisponible : les noms restent à relier.
        this.logger.warn({
          event: 'ingredient_enrichment.batch_failed',
          names: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { sheets, costMicroEur };
  }

  /**
   * Import de recettes : les noms inconnus deviennent des fiches complètes. Admin :
   * fiches communes actives ; cuisinier : ses fiches privées en attente de validation,
   * comme s'il les avait saisies. Un nom que l'IA ramène à une fiche existante
   * (« oignons rouges » → « Oignon rouge ») se relie à elle.
   */
  async createForImport(names: string[], owner: SheetOwner): Promise<CreatedSheets> {
    const out: CreatedSheets = {
      links: new Map(),
      created: [],
      skipped: [],
      notIngredients: [],
      costMicroEur: 0,
    };
    if (names.length === 0) return out;
    const chefProfileId = owner.kind === 'chef' ? owner.chefProfileId : null;
    const { sheets, costMicroEur } = await this.sheets(names, {
      chefProfileId,
      tag: 'origine:import',
    });
    out.costMicroEur = costMicroEur;
    const answered = new Set(sheets.map((s) => s.asked));
    out.skipped.push(...names.filter((n) => !answered.has(n.trim())));

    const existing = await this.prisma.catalogIngredient.findMany({
      where: {
        OR: [
          { chefProfileId: null, status: 'active' },
          ...(chefProfileId
            ? [{ chefProfileId, status: { in: ['active', 'pending'] } }]
            : []),
        ],
      },
      select: { id: true, name: true, aliases: true },
    });
    const index = matchIndex(existing);
    let chefBudget =
      owner.kind === 'chef'
        ? CHEF_DAILY_CAP -
          (await this.prisma.catalogIngredient.count({
            where: {
              createdByUserId: owner.userId,
              createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) },
            },
          }))
        : Infinity;

    for (const sheet of sheets) {
      const asked = sheet.asked.trim().toLowerCase();
      if (!sheet.isIngredient) {
        out.skipped.push(sheet.asked);
        out.notIngredients.push(sheet.asked);
        continue;
      }
      const known = index.get(matchKey(sheet.name));
      if (known) {
        out.links.set(asked, known);
        await this.learnAlias(known, asked, existing, owner);
        continue;
      }
      if (chefBudget <= 0) {
        out.skipped.push(sheet.asked);
        continue;
      }
      const aliases =
        normalizeName(sheet.name) === normalizeName(sheet.asked) ? [] : [asked];
      try {
        const id = await this.createSheet(sheet, aliases, owner);
        out.links.set(asked, id);
        out.created.push({ id, name: sheet.name });
        index.set(matchKey(sheet.name), id);
        chefBudget -= 1;
      } catch (error) {
        // Le nom vient d'être pris (import en parallèle) : la fiche existe, on la relie.
        const holder = await this.prisma.catalogIngredient.findFirst({
          where: {
            normalizedName: normalizeName(sheet.name),
            status: { not: 'merged' },
            OR: [{ chefProfileId: null }, ...(chefProfileId ? [{ chefProfileId }] : [])],
          },
          select: { id: true },
        });
        if (holder) out.links.set(asked, holder.id);
        else {
          out.skipped.push(sheet.asked);
          this.logger.warn({
            event: 'ingredient_enrichment.create_failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (out.created.length > 0) {
      await this.audit.record({
        actorType: owner.kind === 'admin' ? 'admin' : 'chef',
        actorUserId: owner.userId,
        action: 'catalog_ingredient.ai_created',
        subjectType: 'catalog_ingredient',
        metadata: { ids: out.created.map((c) => c.id), origin: 'recipe_import' },
      });
    }
    return out;
  }

  /**
   * Admin seulement : le nom lu devient un « autre nom » de la fiche commune à
   * laquelle l'IA l'a ramené, pour que les imports suivants la relient d'emblée.
   * Une fiche privée de cuisinier n'est jamais touchée.
   */
  private async learnAlias(
    id: string,
    asked: string,
    existing: { id: string; name: string; aliases: string[] }[],
    owner: SheetOwner,
  ) {
    if (owner.kind !== 'admin') return;
    const entry = existing.find((e) => e.id === id);
    if (!entry || normalizeName(entry.name) === normalizeName(asked)) return;
    if (entry.aliases.some((a) => normalizeName(a) === normalizeName(asked))) return;
    try {
      await this.ingredients.update(
        id,
        { aliases: [...entry.aliases, asked] },
        owner.userId,
      );
      entry.aliases.push(asked);
    } catch (error) {
      this.logger.warn({
        event: 'ingredient_enrichment.alias_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createSheet(
    sheet: EnrichedIngredient,
    aliases: string[],
    owner: SheetOwner,
  ): Promise<string> {
    const payload = {
      name: sheet.name,
      aliases,
      aisle: sheet.aisle,
      diets: sheet.diets,
      seasonMonths: sheet.seasonMonths,
      isBasic: sheet.isBasic,
      ...(sheet.allergensNone ? { allergensNone: true } : { allergens: sheet.allergens }),
    };
    if (owner.kind === 'admin') {
      return (await this.ingredients.create(payload, owner.userId)).id;
    }
    const data = (await this.ingredients.toWrite(
      payload,
    )) as Prisma.CatalogIngredientUncheckedCreateInput;
    const row = await this.prisma.catalogIngredient.create({
      data: {
        ...data,
        status: 'pending',
        chefProfileId: owner.chefProfileId,
        createdByUserId: owner.userId,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Les fiches communes à compléter : sans rayon, ou allergènes ni listés ni « aucun ». */
  private incompleteWhere(): Prisma.CatalogIngredientWhereInput {
    return {
      chefProfileId: null,
      status: { in: ['active', 'inactive'] },
      OR: [
        { aisle: null },
        { AND: [{ allergens: { isEmpty: true } }, { allergensNone: false }] },
      ],
    };
  }

  /** Combien de fiches le rattrapage toucherait. */
  async incompleteCount() {
    return this.prisma.catalogIngredient.count({ where: this.incompleteWhere() });
  }

  /**
   * Rattrapage : l'IA remplit les champs vides des fiches incomplètes (jamais un
   * champ déjà saisi), par le même chemin qu'une modification de l'admin, donc
   * reportée dans les recettes (§7.3), les cuisiniers prévenus une fois chacun.
   */
  async completeIncomplete(adminUserId: string, limit = COMPLETE_MAX) {
    const rows = await this.prisma.catalogIngredient.findMany({
      where: this.incompleteWhere(),
      select: {
        id: true,
        name: true,
        aisle: true,
        allergens: true,
        allergensNone: true,
        diets: true,
      },
      orderBy: { name: 'asc' },
      take: Math.max(1, Math.min(limit, COMPLETE_MAX)),
    });
    const { sheets, costMicroEur } = await this.sheets(
      rows.map((r) => r.name),
      { tag: 'origine:rattrapage' },
    );
    const byName = new Map(sheets.map((s) => [s.asked.trim(), s]));
    const tell: ChefsToTell = new Map();
    const completed: { id: string; name: string }[] = [];
    const failed: { id: string; name: string; message: string }[] = [];
    const propagation: Partial<PropagationResult> = {};
    for (const row of rows) {
      const sheet = byName.get(row.name.trim());
      if (!sheet) {
        failed.push({
          id: row.id,
          name: row.name,
          message: "L'IA n'a pas rendu de fiche.",
        });
        continue;
      }
      const patch = missingFieldsPatch(row, sheet);
      if (Object.keys(patch).length === 0) continue;
      try {
        const result = await this.ingredients.update(row.id, patch, adminUserId, {
          tell,
        });
        completed.push({ id: row.id, name: row.name });
        if (result.propagation) {
          for (const [key, value] of Object.entries(result.propagation)) {
            if (typeof value === 'number') {
              const k = key as keyof PropagationResult;
              propagation[k] = ((propagation[k] as number | undefined) ?? 0) + value;
            }
          }
        }
      } catch (error) {
        failed.push({
          id: row.id,
          name: row.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.propagation.tellChefs(tell);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: adminUserId,
      action: 'catalog_ingredient.ai_completed',
      subjectType: 'catalog_ingredient',
      metadata: { completed: completed.length, failed: failed.length, costMicroEur },
    });
    return {
      completed: completed.length,
      failed,
      remaining: await this.incompleteCount(),
      costMicroEur,
    };
  }
}
