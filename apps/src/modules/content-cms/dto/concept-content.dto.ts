import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CmsPage } from '../../../generated/prisma/client';

import {
  CmsHeroContent,
  CmsHowItWorksStep,
  CmsIntroBlock,
  CmsReassuranceItem,
} from '../../../supabase/types/cms-content';
import {
  CmsHeroContentDto,
  CmsHowItWorksStepDto,
  CmsIntroBlockDto,
  CmsReassuranceItemDto,
} from './concept-content-parts.dto';
import type { ConceptPageContent } from '../concept-defaults';

export class ConceptContentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiProperty({ type: CmsHeroContentDto })
  @ValidateNested()
  @Type(() => CmsHeroContentDto)
  hero!: CmsHeroContentDto;

  @ApiProperty({ type: CmsIntroBlockDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CmsIntroBlockDto)
  introBlocks!: CmsIntroBlockDto[];

  @ApiProperty({ type: CmsHowItWorksStepDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CmsHowItWorksStepDto)
  howItWorks!: CmsHowItWorksStepDto[];

  @ApiProperty({ type: CmsReassuranceItemDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CmsReassuranceItemDto)
  reassuranceItems!: CmsReassuranceItemDto[];

  static fromEntity(page: CmsPage): ConceptContentDto {
    return ConceptContentDto.fromContent({
      title: page.title,
      hero: page.hero as unknown as CmsHeroContent,
      introBlocks: page.introBlocks as unknown as CmsIntroBlock[],
      howItWorks: page.howItWorks as unknown as CmsHowItWorksStep[],
      reassuranceItems: page.reassuranceItems as unknown as CmsReassuranceItem[],
    });
  }

  static fromContent(content: ConceptPageContent): ConceptContentDto {
    return {
      title: content.title,
      hero: content.hero,
      introBlocks: content.introBlocks,
      howItWorks: content.howItWorks,
      reassuranceItems: content.reassuranceItems,
    };
  }
}
