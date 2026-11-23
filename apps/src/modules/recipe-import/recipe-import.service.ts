import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DAY_MS, parisMinute, parisToday } from '../../common/paris-time';
import { fieldErrors } from '../../common/validation.pipe';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGateway } from '../ai/ai-gateway.service';
import { aiFeatureClosed } from '../ai/ai.errors';
import { recipeImportInForce, recipeImportOpenTo } from '../ai/ai-settings';
import type { AiContent } from '../ai/providers/ai-provider';
import { ChefContentService } from '../dishes/chef-content.service';
import { DishesService } from '../dishes/dishes.service';
import { CreateDishDto } from '../dishes/dto/dish.dto';
import {
  allergenGaps,
  certainLinkRate,
  CERTAIN_LINK_THRESHOLD,
  duplicateOf,
  linkIndex,
  toDishDraft,
} from './domain/draft.rules';
import {
  fileProblem,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  sniffType,
  IMPORT_MIME_TYPES,
} from './domain/import-file.rules';
import {
  IGNORED_NAMES_KEY,
  ignoredFrom,
  unlinkedProposals,
  withIgnored,
} from './domain/unlinked-names.rules';
import { pageForModel } from './domain/url-source.rules';
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SCHEMA_NAME,
  extractionPrompt,
  PUBLISHED_SOURCE_NOTE,
  type Extraction,
} from './extraction/schema';
import { parseExtraction } from './extraction/scoring';
import { routesFor } from './import-routes';
import { RecipeImportStorageService } from './recipe-import-storage.service';
import { fetchPublicPage, UnsafeUrlError } from './safe-fetch';

export const IMPORTS_PER_DAY = 30;
export const IMPORTS_IN_FLIGHT = 3;
export const STUCK_AFTER_MS = 5 * 60 * 1000;
export const KEEP_FILES_DAYS = 30;
export const MAX_TEXT = 30_000;

export type SourceType = 'file' | 'text' | 'url' | 'title';

export interface CreateImportInput {
  sourceType: SourceType;
  uploadIds?: string[];
  text?: string;
  url?: string;
  title?: string;
}

/** Une erreur métier lisible par le cuisinier, gardée sur l'import. */
class ImportFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ImportRow = Prisma.RecipeImportGetPayload<{
  include: { meals: { select: { id: true; name: true } } };
}>;

interface Report {
  estimatedFields?: string[];
  warnings?: string[];
  allergenGaps?: string[];
  linked?: number;
  toVerify?: number;
  unlinkedNames?: string[];
  duplicateOf?: { id: string; name: string } | null;
  candidates?: { index: number; name: string; ingredients: number }[];
  belowThreshold?: boolean;
}

const quotaReached = (message: string) =>
  new HttpException(
    { code: 'RECIPE_IMPORT_QUOTA', message },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Import de recettes par IA (DAT §4, plan J4). Le cuisinier envoie une source ; la
 * réponse part tout de suite (`pending`), le traitement suit dans le même processus :
 * contrôles, lecture par l'IA via `AiGateway`, liaison au référentiel, brouillon créé
 * par le service des plats (allergènes à confirmer). Plusieurs recettes ou un doublon :
 * le cuisinier choisit (`review`). Un cron libère les imports bloqués et purge les
 * fichiers au bout de 30 jours.
 */
@Injectable()
export class RecipeImportService {
  private readonly logger = new Logger(RecipeImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly storage: RecipeImportStorageService,
    private readonly access: ChefContentService,
    private readonly dishes: DishesService,
  ) {}

  /** Ouvert à ce cuisinier ? (pour afficher ou non le bouton) */
  async availability(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const settings = await recipeImportInForce(this.prisma);
    return { enabled: recipeImportOpenTo(settings, chef.id) && chef.isVerified };
  }

  private async openChef(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    this.access.assertVerified(chef);
    const settings = await recipeImportInForce(this.prisma);
    if (!recipeImportOpenTo(settings, chef.id)) throw aiFeatureClosed();
    return { chef, settings };
  }

  async uploadUrl(clerkUserId: string, mimeType: string, sizeBytes: number) {
    const { chef } = await this.openChef(clerkUserId);
    if (!(IMPORT_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Formats acceptés : PDF, JPEG, PNG, WebP.',
      });
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMPORT_BYTES) {
      throw new UnprocessableEntityException({
        code: 'FILE_TOO_LARGE',
        message: `Fichier trop lourd : ${MAX_IMPORT_BYTES / 1024 / 1024} Mo au plus.`,
      });
    }
    return this.storage.createUploadUrl(chef.id, mimeType);
  }

  async create(clerkUserId: string, input: CreateImportInput) {
    const { chef } = await this.openChef(clerkUserId);
    await this.assertQuota(chef.id);
    const data = this.sourceFields(chef.id, input);
    const row = await this.prisma.recipeImport.create({
      data: { chefProfileId: chef.id, sourceType: input.sourceType, ...data },
      include: { meals: { select: { id: true, name: true } } },
    });
    // Après la réponse : le cuisinier suit l'avancement par GET.
    setImmediate(() => void this.process(row.id, clerkUserId));
    return view(row);
  }

  async get(clerkUserId: string, id: string) {
    return view(await this.owned(clerkUserId, id));
  }

  async list(clerkUserId: string) {
    const chef = await this.access.chef(clerkUserId);
    const rows = await this.prisma.recipeImport.findMany({
      where: { chefProfileId: chef.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { meals: { select: { id: true, name: true } } },
    });
    return rows.map(view);
  }

  /** Après `review` : la recette choisie devient un brouillon. */
  async choose(clerkUserId: string, id: string, index: number) {
    const row = await this.owned(clerkUserId, id);
    if (row.status !== 'review') {
      throw new HttpException(
        {
          code: 'RECIPE_IMPORT_NOT_IN_REVIEW',
          message: "Cet import n'attend pas de choix.",
        },
        HttpStatus.CONFLICT,
      );
    }
    const extraction = row.extraction as unknown as Extraction | null;
    const recipe = extraction?.recipes[index];
    if (!recipe) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Recette inconnue.',
      });
    }
    await this.toDraft(row, extraction, index, clerkUserId, (row.report ?? {}) as Report);
    return this.get(clerkUserId, id);
  }

  private async owned(clerkUserId: string, id: string): Promise<ImportRow> {
    const chef = await this.access.chef(clerkUserId);
    const row = await this.prisma.recipeImport.findFirst({
      where: { id, chefProfileId: chef.id },
      include: { meals: { select: { id: true, name: true } } },
    });
    // Même réponse pour l'import d'un autre et un import inconnu.
    if (!row) throw new NotFoundException('Import introuvable.');
    return row;
  }

  private async assertQuota(chefProfileId: string) {
    const since = parisMinute(parisToday(), 0);
    const [today, inFlight] = await Promise.all([
      this.prisma.recipeImport.count({
        where: { chefProfileId, createdAt: { gte: since } },
      }),
      this.prisma.recipeImport.count({
        where: { chefProfileId, status: { in: ['pending', 'processing'] } },
      }),
    ]);
    if (today >= IMPORTS_PER_DAY) {
      throw quotaReached(
        `${IMPORTS_PER_DAY} imports par jour au plus. Réessayez demain.`,
      );
    }
    if (inFlight >= IMPORTS_IN_FLIGHT) {
      throw quotaReached(
        `${IMPORTS_IN_FLIGHT} imports en cours au plus. Attendez la fin de l'un d'eux.`,
      );
    }
  }

  private sourceFields(chefProfileId: string, input: CreateImportInput) {
    const bad = (message: string) =>
      new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message });
    switch (input.sourceType) {
      case 'file': {
        const ids = [...new Set(input.uploadIds ?? [])];
        if (ids.length === 0 || ids.length > MAX_IMPORT_FILES) {
          throw bad(`Envoyez de 1 à ${MAX_IMPORT_FILES} fichiers.`);
        }
        const paths = ids.map((uid) => this.storage.pathOf(chefProfileId, uid));
        if (paths.some((p) => p === null)) throw bad('Dépôt inconnu.');
        return { storagePaths: paths as string[] };
      }
      case 'text': {
        const text = input.text?.trim() ?? '';
        if (text.length < 20)
          throw bad('Collez le texte de la recette (20 caractères au moins).');
        return { sourceText: text.slice(0, MAX_TEXT) };
      }
      case 'url': {
        const url = input.url?.trim() ?? '';
        if (!url) throw bad('Le lien est vide.');
        return { sourceUrl: url.slice(0, 2048) };
      }
      case 'title': {
        const title = input.title?.trim() ?? '';
        if (title.length < 3) throw bad('Donnez le nom du plat.');
        return { sourceTitle: title.slice(0, 255) };
      }
      default:
        throw bad('Type de source inconnu.');
    }
  }

  /** Le traitement complet d'un import ; ne lève jamais (l'échec est écrit sur l'import). */
  async process(id: string, clerkUserId: string): Promise<void> {
    const claimed = await this.prisma.recipeImport.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'processing', startedAt: new Date() },
    });
    if (claimed.count === 0) return;
    const row = await this.prisma.recipeImport.findUniqueOrThrow({
      where: { id },
      include: { meals: { select: { id: true, name: true } } },
    });
    try {
      const settings = await recipeImportInForce(this.prisma);
      const content = await this.contentOf(row);
      const index = await this.indexFor(row.chefProfileId);
      const result = await this.gateway.run<Extraction>({
        labels: {
          poste: 'recettes',
          feature: 'import_recette',
          tags: [
            `source:${row.sourceType}`,
            ...content
              .filter((c) => c.type !== 'text')
              .slice(0, 1)
              .map((c) => `format:${c.type}`),
          ],
        },
        chefProfileId: row.chefProfileId,
        system: extractionPrompt(),
        content,
        schema: EXTRACTION_SCHEMA,
        schemaName: EXTRACTION_SCHEMA_NAME,
        routes: routesFor(content, settings.allowNonEuFallback),
        parse: parseExtraction,
        accept: (data) =>
          row.sourceType === 'title' ||
          (data.recipes.length > 0 &&
            certainLinkRate(data.recipes[0], index) >= CERTAIN_LINK_THRESHOLD),
      });
      const extraction = result.data;
      await this.prisma.recipeImport.update({
        where: { id },
        data: {
          extraction: extraction as unknown as Prisma.InputJsonValue,
          provider: result.provider,
          model: result.model,
          costMicroEur: { increment: result.costMicroEur },
        },
      });
      if (extraction.recipes.length === 0) {
        throw new ImportFailure(
          'NO_RECIPE_FOUND',
          "Aucune recette n'a été trouvée dans cette source.",
        );
      }
      const report: Report = { belowThreshold: result.belowThreshold };
      const existing = await this.prisma.meal.findMany({
        where: { chefProfileId: row.chefProfileId },
        select: { id: true, name: true },
      });
      const duplicate =
        extraction.recipes.length === 1
          ? duplicateOf(extraction.recipes[0].name, existing)
          : null;
      if (extraction.recipes.length > 1 || duplicate) {
        await this.prisma.recipeImport.update({
          where: { id },
          data: {
            status: 'review',
            finishedAt: new Date(),
            report: {
              ...report,
              duplicateOf: duplicate,
              candidates: extraction.recipes.map((r, i) => ({
                index: i,
                name: r.name,
                ingredients: r.ingredients.length,
              })),
            } as Prisma.InputJsonValue,
          },
        });
        return;
      }
      await this.toDraft(row, extraction, 0, clerkUserId, report);
    } catch (error) {
      await this.fail(id, error);
    }
  }

  private async toDraft(
    row: ImportRow,
    extraction: Extraction,
    index: number,
    clerkUserId: string,
    report: Report,
  ) {
    const recipe = extraction.recipes[index];
    const linkIdx = await this.indexFor(row.chefProfileId);
    const draft = toDishDraft(recipe, linkIdx);
    const warnings = [...extraction.warnings, ...draft.warnings];
    if (row.sourceType === 'title') {
      warnings.unshift(
        "Recette proposée par l'IA à partir d'un titre : adaptez-la à votre façon de faire.",
      );
    }
    const payload = await this.validDto(draft.dish);
    const dish = await this.dishes.create(clerkUserId, payload);
    await this.prisma.meal.update({
      where: { id: dish.id },
      data: { importedFromId: row.id },
    });
    const gaps = allergenGaps(
      recipe.suspectedAllergens,
      (dish as { allergens?: string[] }).allergens ?? [],
    );
    await this.prisma.recipeImport.update({
      where: { id: row.id },
      data: {
        status: 'done',
        finishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        report: {
          ...report,
          estimatedFields: draft.estimatedFields,
          warnings,
          allergenGaps: gaps,
          linked: draft.linked,
          toVerify: draft.toVerify,
          unlinkedNames: draft.unlinkedNames,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Le brouillon passé par les mêmes règles que `POST /me/dishes`. Un champ facultatif
   * refusé (pays, catégorie, matériel) est retiré plutôt que de perdre tout l'import.
   */
  private async validDto(dish: object): Promise<CreateDishDto> {
    const droppable = [
      'country',
      'category',
      'equipment',
      'description',
      'difficulty',
      'cookMinutes',
    ];
    let plain = JSON.parse(JSON.stringify(dish)) as Record<string, unknown>;
    for (let pass = 0; pass < 2; pass++) {
      const instance = plainToInstance(CreateDishDto, plain);
      const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length === 0) return instance;
      const fields = fieldErrors(errors);
      const top = new Set(fields.map((f) => f.field.split('.')[0]));
      if (pass === 0 && [...top].every((f) => droppable.includes(f))) {
        plain = Object.fromEntries(Object.entries(plain).filter(([k]) => !top.has(k)));
        continue;
      }
      this.logger.warn({
        event: 'recipe_import.draft_invalid',
        fields: fields.slice(0, 10),
      });
      throw new ImportFailure(
        'DRAFT_INVALID',
        'La recette lue ne peut pas être enregistrée telle quelle.',
      );
    }
    throw new ImportFailure(
      'DRAFT_INVALID',
      'La recette lue ne peut pas être enregistrée telle quelle.',
    );
  }

  private async contentOf(row: ImportRow): Promise<AiContent[]> {
    if (row.sourceType === 'text') return [{ type: 'text', text: row.sourceText ?? '' }];
    if (row.sourceType === 'title') {
      return [
        {
          type: 'text',
          text:
            `Partir d'un titre : propose une recette de base, réaliste et classique, pour « ${row.sourceTitle} ». ` +
            'Il n’y a pas de source : mets dans estimatedFields tous les champs que tu remplis, et ingredients[].certain = true.',
        },
      ];
    }
    if (row.sourceType === 'url') {
      try {
        const html = await fetchPublicPage(row.sourceUrl ?? '');
        return [
          {
            type: 'text',
            text: `${PUBLISHED_SOURCE_NOTE}\n${pageForModel(html, row.sourceUrl ?? '')}`,
          },
        ];
      } catch (error) {
        if (error instanceof UnsafeUrlError)
          throw new ImportFailure('URL_REFUSED', error.message);
        throw new ImportFailure('URL_UNREACHABLE', 'La page ne peut pas être lue.');
      }
    }
    const content: AiContent[] = [];
    for (const path of row.storagePaths) {
      const bytes = await this.storage.read(path);
      if (!bytes)
        throw new ImportFailure('UPLOAD_NOT_CONFIRMED', "Le fichier n'a pas été reçu.");
      const problem = fileProblem(bytes);
      if (problem) throw new ImportFailure(problem.code, problem.message);
      const type = sniffType(bytes);
      content.push(
        type === 'application/pdf'
          ? { type: 'pdf', base64: bytes.toString('base64'), name: 'recette.pdf' }
          : { type: 'image', mimeType: type as string, base64: bytes.toString('base64') },
      );
    }
    if (
      content.filter((c) => c.type === 'pdf').length > 1 ||
      (content.some((c) => c.type === 'pdf') && content.length > 1)
    ) {
      throw new ImportFailure(
        'VALIDATION_FAILED',
        'Un seul PDF par import, ou plusieurs photos.',
      );
    }
    return content;
  }

  /** La liste commune active et les ingrédients privés du cuisinier (Recettes §4.10). */
  private async indexFor(chefProfileId: string) {
    const rows = await this.prisma.catalogIngredient.findMany({
      where: {
        OR: [
          { chefProfileId: null, status: 'active' },
          { chefProfileId, status: { in: ['active', 'pending'] } },
        ],
      },
      select: { id: true, name: true, aliases: true },
    });
    return linkIndex(rows);
  }

  private async fail(id: string, error: unknown) {
    let code = 'IMPORT_FAILED';
    let message = "L'import a échoué. Réessayez ou saisissez la recette à la main.";
    if (error instanceof ImportFailure) {
      code = error.code;
      message = error.message;
    } else if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string; message?: string | string[] };
      code = body.code ?? code;
      if (code === 'AI_BUDGET_REACHED' || code === 'AI_UNAVAILABLE') {
        message = typeof body.message === 'string' ? body.message : message;
      }
    }
    if (!(error instanceof ImportFailure)) {
      this.logger.error(
        { event: 'recipe_import.failed', id, code },
        error instanceof Error ? error.stack : undefined,
      );
    }
    await this.prisma.recipeImport.update({
      where: { id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: code,
        errorMessage: message.slice(0, 500),
      },
    });
  }

  /** Un import resté en cours (redémarrage, délai) passe en échec au bout de 5 minutes. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'recipe-imports-stuck' })
  async releaseStuck(now: Date = new Date()) {
    const before = new Date(now.getTime() - STUCK_AFTER_MS);
    const { count } = await this.prisma.recipeImport.updateMany({
      where: {
        OR: [
          { status: 'processing', startedAt: { lt: before } },
          { status: 'pending', createdAt: { lt: before } },
        ],
      },
      data: {
        status: 'failed',
        finishedAt: now,
        errorCode: 'TIMEOUT',
        errorMessage: "L'import a pris trop de temps. Réessayez.",
      },
    });
    if (count) this.logger.warn({ event: 'recipe_import.stuck_released', count });
    return count;
  }

  /** Les fichiers et textes envoyés sont effacés au bout de 30 jours. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'recipe-imports-purge',
    timeZone: 'Europe/Paris',
  })
  async purge(now: Date = new Date()) {
    const before = new Date(now.getTime() - KEEP_FILES_DAYS * DAY_MS);
    const rows = await this.prisma.recipeImport.findMany({
      where: { createdAt: { lt: before }, filesPurgedAt: null },
      select: { id: true, storagePaths: true },
      take: 500,
    });
    let purged = 0;
    for (const row of rows) {
      try {
        await this.storage.remove(row.storagePaths);
        await this.prisma.recipeImport.update({
          where: { id: row.id },
          data: {
            filesPurgedAt: now,
            storagePaths: [],
            sourceText: null,
            extraction: Prisma.DbNull,
          },
        });
        purged += 1;
      } catch (error) {
        this.logger.error(
          { event: 'recipe_import.purge_failed', id: row.id },
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return purged;
  }

  /** Console : les noms jamais reliés après import, les plus fréquents d'abord. */
  async unlinkedNames(days: number, now: Date = new Date()) {
    const since = new Date(now.getTime() - days * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      { name: string; count: bigint; chefs: bigint }[]
    >`
      SELECT lower(n.name) AS name, COUNT(*)::bigint AS count, COUNT(DISTINCT ri.chef_profile_id)::bigint AS chefs
      FROM recipe_imports ri,
           jsonb_array_elements_text(COALESCE(ri.report->'unlinkedNames', '[]'::jsonb)) AS n(name)
      WHERE ri.created_at >= ${since}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 500`;
    const [entries, ignored] = await Promise.all([
      this.prisma.catalogIngredient.findMany({
        where: { chefProfileId: null, status: 'active' },
        select: { id: true, name: true, aliases: true },
      }),
      this.prisma.platformSetting.findUnique({ where: { key: IGNORED_NAMES_KEY } }),
    ]);
    return unlinkedProposals(
      rows.map((r) => ({ name: r.name, count: Number(r.count), chefs: Number(r.chefs) })),
      entries,
      ignoredFrom(ignored?.value ?? null),
    ).slice(0, 200);
  }

  /** L'admin écarte un nom (« huile », « échalote et ail ») : il ne remonte plus. */
  async ignoreUnlinkedName(name: string, adminUserId: string) {
    const current = await this.prisma.platformSetting.findUnique({
      where: { key: IGNORED_NAMES_KEY },
    });
    const keys = withIgnored(ignoredFrom(current?.value ?? null), name);
    await this.prisma.platformSetting.upsert({
      where: { key: IGNORED_NAMES_KEY },
      update: { value: { keys }, updatedByUserId: adminUserId },
      create: { key: IGNORED_NAMES_KEY, value: { keys }, updatedByUserId: adminUserId },
    });
    return { ignored: keys.length };
  }
}

/** Ce que le cuisinier voit d'un import. */
export function view(row: ImportRow) {
  const report = (row.report ?? {}) as Report;
  return {
    id: row.id,
    sourceType: row.sourceType,
    status: row.status,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null,
    meals: row.meals,
    estimatedFields: report.estimatedFields ?? [],
    warnings: report.warnings ?? [],
    allergenGaps: report.allergenGaps ?? [],
    linked: report.linked ?? null,
    toVerify: report.toVerify ?? null,
    duplicateOf: report.duplicateOf ?? null,
    candidates: report.candidates ?? [],
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
