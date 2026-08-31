import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Page size applied when a caller omits `limit`. */
export const DEFAULT_PAGE_SIZE = 20;

/** Upper bound on `limit`, so one request can never scan an unbounded table. */
export const MAX_PAGE_SIZE = 100;

/**
 * Page/limit query parameters shared by admin list endpoints.
 *
 * Extend this class instead of re-declaring the two parameters, so every list
 * endpoint validates and defaults them identically.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: '1-based page number.',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: `Rows per page (max ${MAX_PAGE_SIZE}).`,
    example: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

/** Page descriptor returned alongside every paginated payload. */
export class PaginationMetaDto {
  @ApiProperty({ description: '1-based page number that was served.', example: 1 })
  page!: number;

  @ApiProperty({
    description: 'Rows per page that was applied.',
    example: DEFAULT_PAGE_SIZE,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total rows matching the filters, across every page.',
    example: 137,
  })
  total!: number;

  @ApiProperty({
    description: 'Number of pages available for the current `limit`.',
    example: 7,
  })
  totalPages!: number;

  @ApiProperty({
    description: 'Whether a page after this one exists.',
    example: true,
  })
  hasNextPage!: boolean;

  @ApiProperty({
    description: 'Whether a page before this one exists.',
    example: false,
  })
  hasPreviousPage!: boolean;
}

/** Envelope shape returned by paginated list endpoints. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMetaDto;
}

/** Normalised page/limit plus the Prisma `skip`/`take` derived from them. */
export interface PageBounds {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * Applies defaults and clamps to a validated (or absent) pagination query.
 *
 * The `ValidationPipe` already rejects out-of-range values on HTTP requests;
 * clamping here keeps direct service calls (tests, scripts, internal callers)
 * from issuing an unbounded query.
 */
export function resolvePageBounds(query: PaginationQueryDto = {}): PageBounds {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE)),
  );

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/** Builds the `meta` block from the served page and the total row count. */
export function buildPaginationMeta(
  bounds: Pick<PageBounds, 'page' | 'limit'>,
  total: number,
): PaginationMetaDto {
  const totalPages = total === 0 ? 0 : Math.ceil(total / bounds.limit);

  return {
    page: bounds.page,
    limit: bounds.limit,
    total,
    totalPages,
    hasNextPage: bounds.page < totalPages,
    hasPreviousPage: bounds.page > 1,
  };
}
