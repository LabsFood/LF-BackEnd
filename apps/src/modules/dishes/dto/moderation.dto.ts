import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { MODERATION_REASON_CODES, REASON_LENGTH } from '../domain/moderation.rules';

export class ContentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['pending'],
    description:
      '`pending`: the review queue, dishes **and** menus that were published and ' +
      'that nobody has looked at since. Without it: batch cookers’ dishes only.',
    example: 'pending',
  })
  @IsOptional()
  @IsIn(['pending'])
  review?: 'pending';

  @ApiPropertyOptional({ enum: ['dish', 'menu'], description: 'Only one kind.' })
  @IsOptional()
  @IsIn(['dish', 'menu'])
  type?: 'dish' | 'menu';

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this batch cooker’s content.',
  })
  @IsOptional()
  @IsUUID('4')
  chefId?: string;
}

export class ReviewDto {
  @ApiProperty({
    enum: ['ok'],
    description: 'Looked at, nothing to change.',
    example: 'ok',
  })
  @IsIn(['ok'])
  outcome!: 'ok';

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'For other admins; the batch cooker never sees it.',
    example: 'Allergène libre « sarrasin » légitime.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ModerationDto {
  @ApiProperty({
    enum: ['suspended', 'published'],
    description: '`suspended` takes it down; `published` lifts a suspension.',
    example: 'suspended',
  })
  @IsIn(['suspended', 'published'])
  status!: 'suspended' | 'published';

  @ApiProperty({
    minLength: REASON_LENGTH.min,
    maxLength: REASON_LENGTH.max,
    description:
      `Why, in ${REASON_LENGTH.min} to ${REASON_LENGTH.max} characters, else ` +
      '`422 REASON_REQUIRED`. The batch cooker reads it exactly as written.',
    example:
      'Les allergènes ne mentionnent pas le lait, alors que la recette contient du ' +
      'beurre et du parmesan. Merci de compléter la déclaration avant de republier.',
  })
  // No length limit here: the service checks 15–500 and answers REASON_REQUIRED
  // for any other length, as documented. The request body limit bounds the rest.
  @IsString()
  reason!: string;

  @ApiPropertyOptional({
    enum: MODERATION_REASON_CODES,
    default: 'other',
    description: 'For a suspension: which kind of problem.',
    example: 'allergens-incomplete',
  })
  @IsOptional()
  @IsIn(MODERATION_REASON_CODES)
  reasonCode?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Email the batch cooker about the suspension.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyChef?: boolean;
}
