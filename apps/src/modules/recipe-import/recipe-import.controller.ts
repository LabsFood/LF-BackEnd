import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AdminGuard } from '../../auth/admin.guard';
import { ClerkAuthGuard, ClerkUser } from '../../auth/clerk-auth.guard';
import { CurrentClerkUser } from '../../auth/current-clerk-user.decorator';
import {
  ApiAdminAuthResponses,
  ApiClerkAuthResponses,
} from '../../common/swagger/auth-responses';
import { AuditService } from '../../common/audit/audit.service';
import { TAGS } from '../../common/swagger/tags';
import { UsersService } from '../users/users.service';
import {
  IMPORT_MIME_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
} from './domain/import-file.rules';
import { MAX_TEXT, RecipeImportService, type SourceType } from './recipe-import.service';

class IgnoreNameDto {
  @ApiProperty({ example: 'échalote et ail', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  name!: string;
}

class CreateNamesDto {
  @ApiProperty({ type: [String], example: ['pâte de tamarin', 'galanga'], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  names!: string[];
}

class ImportUploadUrlDto {
  @ApiProperty({ enum: IMPORT_MIME_TYPES, example: 'application/pdf' })
  @IsIn(IMPORT_MIME_TYPES)
  mimeType!: string;

  @ApiProperty({ maximum: MAX_IMPORT_BYTES, example: 524288 })
  @IsInt()
  @Min(1)
  @Max(MAX_IMPORT_BYTES)
  sizeBytes!: number;
}

class CreateImportDto {
  @ApiProperty({ enum: ['file', 'text', 'url', 'title'] })
  @IsIn(['file', 'text', 'url', 'title'])
  sourceType!: SourceType;

  @ApiPropertyOptional({
    type: [String],
    description: `\`file\` : les \`uploadId\` déposés, ${MAX_IMPORT_FILES} au plus (un PDF, ou plusieurs photos d’une même recette).`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_FILES)
  @Matches(/^ri_[0-9a-f]{24}$/, { each: true })
  uploadIds?: string[];

  @ApiPropertyOptional({
    maxLength: MAX_TEXT,
    description: '`text` : la recette collée.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  text?: string;

  @ApiPropertyOptional({
    maxLength: 2048,
    description: '`url` : une page https publique.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: '`title` : le nom du plat, l’IA propose une base.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

class ChooseDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'L’index de la recette dans `candidates`.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  index?: number;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Plusieurs recettes à créer d’un coup (index dans `candidates`). Le premier brouillon est celui à ouvrir.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(50, { each: true })
  indexes?: number[];
}

const IMPORT_EXAMPLE = {
  id: '6f1c2f0e-8a51-4a5e-9a51-2a8f2e1b7c11',
  sourceType: 'file',
  status: 'done',
  error: null,
  meals: [{ id: '0c7b2a0e-1b6f-4b0e-8f3a-1d2c3b4a5f6e', name: 'Poulet basquaise' }],
  estimatedFields: ['portions'],
  warnings: [],
  allergenGaps: ['celery'],
  linked: 9,
  toVerify: 2,
  duplicateOf: null,
  candidates: [],
  createdAt: '2026-11-22T09:00:00.000Z',
  finishedAt: '2026-11-22T09:00:21.000Z',
};

/**
 * Import de recettes par IA (DAT §4). Ouvert selon le réglage de la console ; le
 * brouillon créé reste à relire, ses allergènes à confirmer.
 */
@Controller()
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
export class RecipeImportController {
  constructor(
    private readonly imports: RecipeImportService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('me/recipe-imports/availability')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Can I import recipes with AI?',
    description: 'To show the import button or not.',
  })
  @ApiOkResponse({ example: { enabled: true } })
  @ApiClerkAuthResponses()
  availability(@CurrentClerkUser() user: ClerkUser) {
    return this.imports.availability(user.userId);
  }

  @Post('me/recipe-imports/upload-url')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Get a URL to upload a recipe file',
    description:
      'PDF, JPEG, PNG or WebP, 10 MB at most, into a private bucket. `PUT` the file to ' +
      '`url` with `headers`, then pass `uploadId` to `POST /me/recipe-imports`.',
  })
  @ApiOkResponse({ description: 'The signed upload.' })
  @ApiClerkAuthResponses()
  uploadUrl(@CurrentClerkUser() user: ClerkUser, @Body() body: ImportUploadUrlDto) {
    return this.imports.uploadUrl(user.userId, body.mimeType, body.sizeBytes);
  }

  @Post('me/recipe-imports')
  @HttpCode(202)
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Import a recipe',
    description:
      'Answers at once with `status: pending`; poll `GET /me/recipe-imports/{id}` every ' +
      'two seconds. `done`: `meals` holds the draft to open. `review`: several recipes ' +
      'were found (`candidates`) or a dish of the same name exists (`duplicateOf`), ' +
      'answer with `POST .../choose`. `failed`: `error.message` says why, in French.\n\n' +
      'Quotas: 30 imports a day, 3 at a time (`429 RECIPE_IMPORT_QUOTA`). Closed for ' +
      'this account: `503 AI_FEATURE_CLOSED`.',
  })
  @ApiAcceptedResponse({ example: { ...IMPORT_EXAMPLE, status: 'pending', meals: [] } })
  @ApiClerkAuthResponses()
  create(@CurrentClerkUser() user: ClerkUser, @Body() body: CreateImportDto) {
    return this.imports.create(user.userId, body);
  }

  @Get('me/recipe-imports')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({ summary: 'List my last 20 imports' })
  @ApiOkResponse({ example: [IMPORT_EXAMPLE] })
  @ApiClerkAuthResponses()
  list(@CurrentClerkUser() user: ClerkUser) {
    return this.imports.list(user.userId);
  }

  @Get('me/recipe-imports/:id')
  @ApiTags(TAGS.chefContent)
  @ApiOperation({ summary: 'Follow an import' })
  @ApiOkResponse({ example: IMPORT_EXAMPLE })
  @ApiClerkAuthResponses()
  get(@CurrentClerkUser() user: ClerkUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(user.userId, id);
  }

  @Post('me/recipe-imports/:id/choose')
  @HttpCode(200)
  @ApiTags(TAGS.chefContent)
  @ApiOperation({
    summary: 'Choose the recipe to import',
    description:
      'For an import in `review`: each chosen recipe (`indexes`, or a single `index`) becomes a draft (a variant if the name exists). `meals[0]` is the one to open.',
  })
  @ApiOkResponse({ example: IMPORT_EXAMPLE })
  @ApiClerkAuthResponses()
  choose(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChooseDto,
  ) {
    return this.imports.choose(
      user.userId,
      id,
      body.indexes ?? (body.index !== undefined ? [body.index] : []),
    );
  }

  @Get('admin/recipe-imports/unlinked-names')
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: 'Read the ingredient names imports could not link',
    description:
      'Most frequent first, with how many batch cookers met them: candidates for the ' +
      'common list, or for another name of an existing entry. Spellings with the same ' +
      'match key are grouped; names the common list now knows and names an admin ' +
      'ignored are left out. `suggestion` is the existing entry whose name or other ' +
      'name sits, in whole words, in the name read (longest first), or `null`.',
  })
  @ApiQuery({ name: 'days', required: false, description: '1 to 366, 30 by default.' })
  @ApiOkResponse({
    example: [
      {
        name: 'piment rouge thaï',
        count: 4,
        chefs: 3,
        suggestion: { id: '0b6f…', name: 'Piment rouge', aliases: [] },
      },
    ],
  })
  @ApiAdminAuthResponses()
  unlinked(@Query('days') days?: string) {
    const n = Number(days);
    return this.imports.unlinkedNames(Number.isInteger(n) && n >= 1 && n <= 366 ? n : 30);
  }

  @Post('admin/recipe-imports/unlinked-names/ignore')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: 'Ignore an unlinked ingredient name',
    description:
      'The name (by its match key) no longer comes up in the unlinked names: for ' +
      'what is no ingredient ("huile", "échalote et ail"). Recorded in the audit log.',
  })
  @ApiOkResponse({ example: { ignored: 12 } })
  @ApiAdminAuthResponses()
  async ignore(
    @CurrentClerkUser() user: ClerkUser,
    @Body() body: IgnoreNameDto,
    @Req() req: { id?: unknown },
  ) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    const result = await this.imports.ignoreUnlinkedName(body.name.trim(), admin.id);
    await this.audit.record({
      actorType: 'admin',
      actorUserId: admin.id,
      action: 'recipe_import.unlinked_name_ignored',
      subjectType: 'platform_setting',
      metadata: { name: body.name.trim() },
      requestId: typeof req.id === 'string' ? req.id : undefined,
    });
    return result;
  }

  @Post('admin/recipe-imports/unlinked-names/create-with-ai')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: 'Turn unlinked names into complete entries with AI',
    description:
      'Up to 20 `names` from the unlinked names. The AI (`recettes` / `fiche_ingredient` ' +
      'budget) fills each entry: aisle of the list in force, allergens or "none", diets, ' +
      'season, pantry staple. A name the AI brings back to an existing entry becomes ' +
      'one of its other names; what it judges is no ingredient is ignored, as with ' +
      '`/ignore`. New entries are common, active and unreviewed. Recorded in the audit log.',
  })
  @ApiOkResponse({
    example: {
      created: [{ id: '0b6f…', name: 'Pâte de tamarin' }],
      linked: 2,
      ignored: ['échalote et ail'],
      left: [],
      costMicroEur: 400,
    },
  })
  @ApiAdminAuthResponses()
  async createWithAi(@CurrentClerkUser() user: ClerkUser, @Body() body: CreateNamesDto) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return this.imports.createUnlinkedWithAi(
      body.names.map((n) => n.trim()).filter(Boolean),
      admin.id,
    );
  }

  @Post('admin/recipe-imports/upload-url')
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: 'Get a URL to upload a recipe file (console)',
    description:
      "As `POST /me/recipe-imports/upload-url`, for an import into the Lab's Food catalogue.",
  })
  @ApiOkResponse({ description: 'The signed upload.' })
  @ApiAdminAuthResponses()
  adminUploadUrl(@Body() body: ImportUploadUrlDto) {
    return this.imports.adminUploadUrl(body.mimeType, body.sizeBytes);
  }

  @Post('admin/recipe-imports')
  @HttpCode(202)
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: "Read a recipe with AI for the Lab's Food catalogue",
    description:
      "Same sources and quotas as a chef's import, open whatever the chef opening " +
      'setting says (the AI budget applies). No meal is created: poll ' +
      '`GET /admin/recipe-imports/{id}`; once `done`, `drafts` holds one draft per ' +
      'recipe read, for the console form, which the admin saves with `POST /admin/meals`.',
  })
  @ApiAcceptedResponse({
    example: { id: IMPORT_EXAMPLE.id, status: 'pending', drafts: [] },
  })
  @ApiAdminAuthResponses()
  async adminCreate(@CurrentClerkUser() user: ClerkUser, @Body() body: CreateImportDto) {
    return this.imports.adminCreate(await this.adminId(user), body);
  }

  @Get('admin/recipe-imports/:id')
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({ summary: 'Follow a console import' })
  @ApiOkResponse({ description: 'The import, with `drafts` once `done`.' })
  @ApiAdminAuthResponses()
  async adminGet(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.adminGet(await this.adminId(user), id);
  }

  private async adminId(user: ClerkUser) {
    const admin =
      (await this.users.findByClerkId(user.userId)) ??
      (await this.users.ensurePersistedFromClerk(user.userId));
    return admin.id;
  }
}
