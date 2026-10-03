import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

import { CreateMenuDto } from './menu.dto';

/** Lab's Food retires its own content with `archived`; `suspended` is for chefs'. */
const LABS_FOOD_STATUSES = ['draft', 'published', 'archived'];

export class CreateLabsFoodMenuDto extends CreateMenuDto {
  @ApiPropertyOptional({
    enum: LABS_FOOD_STATUSES,
    default: 'draft',
    description:
      '`published` makes it a suggestion every batch cooker can adopt, unless it is ' +
      'offered to one of them. `archived` retires it.',
    example: 'published',
  })
  @IsOptional()
  @IsIn(LABS_FOOD_STATUSES)
  status?: 'draft' | 'published' | 'archived';
}

export class UpdateLabsFoodMenuDto extends PartialType(CreateLabsFoodMenuDto) {}

export class OfferDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker it is prepared for (their chef profile id).',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsUUID('4')
  chefProfileId!: string;
}

export class ConsentDto {
  @ApiProperty({
    description:
      'Must be `true`: nothing is copied or taken over without the batch cooker’s ' +
      'explicit consent, which is recorded (§6).',
    example: true,
  })
  @IsBoolean()
  consent!: boolean;
}
