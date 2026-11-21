import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { TAGS } from '../../common/swagger/tags';
import {
  IMPORT_MIME_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
} from './domain/import-file.rules';
import { MAX_TEXT, RecipeImportService, type SourceType } from './recipe-import.service';

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
  @ApiProperty({ minimum: 0, description: 'L’index de la recette dans `candidates`.' })
  @IsInt()
  @Min(0)
  @Max(50)
  index!: number;
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
  constructor(private readonly imports: RecipeImportService) {}

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
      'For an import in `review`: the chosen recipe becomes a draft (a variant if the name exists).',
  })
  @ApiOkResponse({ example: IMPORT_EXAMPLE })
  @ApiClerkAuthResponses()
  choose(
    @CurrentClerkUser() user: ClerkUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChooseDto,
  ) {
    return this.imports.choose(user.userId, id, body.index);
  }

  @Get('admin/recipe-imports/unlinked-names')
  @UseGuards(AdminGuard)
  @ApiTags(TAGS.adminCatalog)
  @ApiOperation({
    summary: 'Read the ingredient names imports could not link',
    description:
      'Most frequent first, with how many batch cookers met them: candidates for the ' +
      'common list, or for another name of an existing entry.',
  })
  @ApiQuery({ name: 'days', required: false, description: '1 to 366, 30 by default.' })
  @ApiOkResponse({ example: [{ name: 'piment d’espelette', count: 4, chefs: 3 }] })
  @ApiAdminAuthResponses()
  unlinked(@Query('days') days?: string) {
    const n = Number(days);
    return this.imports.unlinkedNames(Number.isInteger(n) && n >= 1 && n <= 366 ? n : 30);
  }
}
