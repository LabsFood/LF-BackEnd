import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecipeSheetQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'Portions to scale the recipe to. Default: those booked.',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  portions?: number;
}

export class ShoppingLineDto {
  @ApiProperty({ maxLength: 120, example: 'Ail' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ minimum: 0, example: 6 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100000)
  qty!: number;

  @ApiProperty({ maxLength: 32, example: 'gousse' })
  @IsString()
  @Length(0, 32)
  unit!: string;

  @ApiProperty({ maxLength: 60, example: 'fruits-legumes' })
  @IsString()
  @Length(1, 60)
  aisle!: string;
}

export class PutShoppingListDto {
  @ApiProperty({
    type: [ShoppingLineDto],
    description:
      'The whole list as the batch cooker wants it. Lines that differ from the ' +
      'recipes are kept as corrections; a computed line left out is struck out.',
  })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ShoppingLineDto)
  lines!: ShoppingLineDto[];
}
