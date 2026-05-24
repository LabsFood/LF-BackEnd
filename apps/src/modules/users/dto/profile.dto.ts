import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertClientProfileDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryPreferences?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  favorites?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  spiceLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  kitchenNotes?: string;
}

export class UpdateClientProfileDto extends PartialType(UpsertClientProfileDto) {}

export class UpdateAdminClientDto extends PartialType(UpsertClientProfileDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
