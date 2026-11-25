import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { ApiAdminAuthResponses } from '../../common/swagger/auth-responses';
import { TAGS } from '../../common/swagger/tags';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AI_POSTES } from './domain/ai-labels.rules';
import { budgetsFrom, MAX_CAP_CENTS } from './domain/ai-budget.rules';
import { PERIOD_LABELS, PERIODS } from './domain/ai-periods.rules';
import { AiUsageService, type BreakdownBy } from './ai-usage.service';
import {
  AI_BUDGETS_KEY,
  budgetsInForce,
  pricesInForce,
  RECIPE_IMPORT_KEY,
  recipeImportFrom,
  recipeImportInForce,
} from './ai-settings';

class CapsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  day?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  week?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  month?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  year?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  rolling24h?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  rolling7d?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  rolling30d?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_CAP_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CAP_CENTS)
  rolling365d?: number;
}

class AiBudgetsDto {
  @ApiProperty({
    enum: ['soft', 'strict'],
    description: 'strict : un appel est refusé dès qu’un plafond concerné est atteint.',
  })
  @IsIn(['soft', 'strict'])
  mode!: 'soft' | 'strict';

  @ApiProperty({ minimum: 10, maximum: 99, example: 80 })
  @IsInt()
  @Min(10)
  @Max(99)
  alertPercent!: number;

  @ApiProperty({
    type: CapsDto,
    description: 'Plafonds globaux en centimes ; une période absente n’est pas limitée.',
  })
  @ValidateNested()
  @Type(() => CapsDto)
  global!: CapsDto;

  @ApiProperty({
    description: 'Plafonds par poste (`recettes`, `vitrine`, ...), même format.',
    example: { recettes: { month: 3000 } },
  })
  @IsObject()
  postes!: Record<string, CapsDto>;
}

class RecipeImportDto {
  @ApiProperty({ enum: ['off', 'beta', 'all'] })
  @IsIn(['off', 'beta', 'all'])
  mode!: 'off' | 'beta' | 'all';

  @ApiProperty({
    type: [String],
    description: 'Profils cuisinier de la bêta (mode `beta`), 200 au plus.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  betaChefProfileIds!: string[];

  @ApiProperty({
    description: 'Renfort par Claude (hors UE) quand Mistral échoue ou lit mal.',
  })
  @IsBoolean()
  allowNonEuFallback!: boolean;
}

const BREAKDOWNS: BreakdownBy[] = [
  'poste',
  'feature',
  'provider',
  'model',
  'chef',
  'tag',
];

const reqId = (req: { id?: unknown }): string | undefined =>
  typeof req.id === 'string' ? req.id : undefined;

const bounded = (value: string | undefined, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
};

/** Budget IA : la page de la console (DAT 6 bis) et l'ouverture de l'import. */
@Controller('admin')
@ApiTags(TAGS.adminDashboard)
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard, AdminGuard)
export class AiController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('ai-usage/summary')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Read AI spending over the eight periods',
    description:
      'Fixed periods in Paris time (today, this week from Monday, this month, this year) ' +
      'and rolling windows (24 h, 7, 30, 365 days), global and per poste, in cents, with ' +
      'the cap and the percentage reached (`null`: no cap).',
  })
  @ApiOkResponse({ description: 'The spending.' })
  summary() {
    return this.usage.summary();
  }

  @Get('ai-usage/daily')
  @ApiAdminAuthResponses()
  @ApiOperation({ summary: 'Read AI spending per Paris day, per poste' })
  @ApiQuery({ name: 'days', required: false, description: '1 to 366, 90 by default.' })
  @ApiOkResponse({
    description: 'One entry per day, oldest first, days without spending included.',
  })
  daily(@Query('days') days?: string) {
    return this.usage.daily(bounded(days, 90, 366));
  }

  @Get('ai-usage/breakdown')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Break AI spending down',
    description:
      'By poste, feature, provider, model, batch cooker or tag, over the last `days` days, ' +
      'with calls, failures, average cost and duration. `poste` narrows to one poste.',
  })
  @ApiQuery({ name: 'by', required: false, enum: BREAKDOWNS })
  @ApiQuery({ name: 'days', required: false, description: '1 to 366, 30 by default.' })
  @ApiQuery({ name: 'poste', required: false })
  @ApiOkResponse({ description: 'Up to 100 rows, most expensive first.' })
  breakdown(
    @Query('by') by?: string,
    @Query('days') days?: string,
    @Query('poste') poste?: string,
  ) {
    const axis = BREAKDOWNS.includes(by as BreakdownBy) ? (by as BreakdownBy) : 'poste';
    return this.usage.breakdown(
      axis,
      bounded(days, 30, 366),
      poste && poste in AI_POSTES ? poste : undefined,
    );
  }

  @Get('ai-budgets')
  @ApiAdminAuthResponses()
  @ApiOperation({ summary: 'Read the AI budgets, the postes and the prices in force' })
  @ApiOkResponse({
    description: 'Budgets in cents; prices in dollars per million tokens.',
  })
  async budgets() {
    return {
      ...(await budgetsInForce(this.prisma)),
      periods: PERIODS.map((p) => ({ code: p, label: PERIOD_LABELS[p] })),
      postesList: Object.entries(AI_POSTES).map(([code, p]) => ({
        code,
        label: p.label,
        features: Object.entries(p.features).map(([fc, label]) => ({ code: fc, label })),
      })),
      prices: await pricesInForce(this.prisma),
    };
  }

  @Put('ai-budgets')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Change the AI budgets',
    description:
      'The whole setting every time. Applies to the next call. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The budgets as stored.' })
  async setBudgets(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: AiBudgetsDto,
    @Req() req: { id?: unknown },
  ) {
    const admin = await this.adminOf(user);
    const previous = await budgetsInForce(this.prisma);
    // Le même lecteur que les appels : un poste inconnu ou une valeur hors bornes tombe.
    const value = budgetsFrom(JSON.parse(JSON.stringify(body)));
    await this.prisma.platformSetting.upsert({
      where: { key: AI_BUDGETS_KEY },
      update: { value: value as object, updatedByUserId: admin.id },
      create: { key: AI_BUDGETS_KEY, value: value as object, updatedByUserId: admin.id },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'settings.ai_budgets_changed',
      subjectType: 'platform_setting',
      metadata: { from: { ...previous }, to: { ...value } },
      requestId: reqId(req),
    });
    return value;
  }

  @Get('ai-settings/recipe-import')
  @ApiAdminAuthResponses()
  @ApiOperation({ summary: 'Read who can import recipes with AI' })
  @ApiOkResponse({
    description: '`off` by default.',
    example: { mode: 'beta', betaChefProfileIds: [], allowNonEuFallback: false },
  })
  recipeImport() {
    return recipeImportInForce(this.prisma);
  }

  @Put('ai-settings/recipe-import')
  @ApiAdminAuthResponses()
  @ApiOperation({
    summary: 'Open or close recipe import',
    description:
      '`off`, `beta` (the listed batch cookers only) or `all`. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The setting as stored.' })
  async setRecipeImport(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: RecipeImportDto,
    @Req() req: { id?: unknown },
  ) {
    const admin = await this.adminOf(user);
    const previous = await recipeImportInForce(this.prisma);
    const value = recipeImportFrom(body);
    await this.prisma.platformSetting.upsert({
      where: { key: RECIPE_IMPORT_KEY },
      update: { value: { ...value }, updatedByUserId: admin.id },
      create: { key: RECIPE_IMPORT_KEY, value: { ...value }, updatedByUserId: admin.id },
    });
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'settings.recipe_import_changed',
      subjectType: 'platform_setting',
      metadata: { from: { ...previous }, to: { ...value } },
      requestId: reqId(req),
    });
    return value;
  }

  private async adminOf(user: ClerkUser) {
    return (
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId))
    );
  }
}
