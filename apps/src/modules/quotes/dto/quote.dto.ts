import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateQuoteDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  persons!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  mealsCount!: number;

  @ApiProperty()
  @IsString()
  cuisine!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diet?: string[];

  @ApiProperty()
  @IsString()
  brief!: string;
}

export class UpdateQuoteAdminDto extends PartialType(CreateQuoteDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountTtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  quoteAmountAfterTax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quoteNote?: string;
}
