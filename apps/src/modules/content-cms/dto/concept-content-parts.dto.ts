import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CmsImageRefDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  src!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  alt!: string;
}

export class CmsHeroContentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subtitle!: string;

  @ApiPropertyOptional({ type: CmsImageRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CmsImageRefDto)
  image?: CmsImageRefDto;
}

export class CmsIntroBlockDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  body!: string;
}

export class CmsHowItWorksStepDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ type: CmsImageRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CmsImageRefDto)
  image?: CmsImageRefDto;
}

export class CmsReassuranceItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;
}
