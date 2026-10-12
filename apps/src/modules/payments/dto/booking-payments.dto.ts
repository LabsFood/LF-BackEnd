import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const URSSAF_LINK_STATUSES = ['pending', 'active', 'refused'] as const;
export type UrssafLinkStatusKey = (typeof URSSAF_LINK_STATUSES)[number];

export class SettleBookingDto {
  @ApiProperty({
    enum: ['urssaf'],
    description:
      'Only the immediate advance settles here. A card goes through ' +
      '`POST /payments/checkout-session`, CESU through `POST /payments/cesu`.',
  })
  @IsIn(['urssaf'])
  method!: 'urssaf';
}

export class RequestUrssafLinkDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The batch cooker to enrol with (`id` in `GET /chefs/{id}`).',
    example: '0e6f7a52-3d0b-4c1e-9a55-2b7c9d1e4f60',
  })
  @IsUUID()
  chefProfileId!: string;
}

export class DecideUrssafLinkDto {
  @ApiProperty({ enum: ['active', 'refused'], example: 'active' })
  @IsIn(['active', 'refused'])
  status!: 'active' | 'refused';

  @ApiPropertyOptional({
    description: 'Why URSSAF refused, shown to the team only.',
    example: 'Compte bancaire non vérifié.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SimulateUrssafOutcomeDto {
  @ApiProperty({ enum: ['paid', 'refused'], example: 'paid' })
  @IsIn(['paid', 'refused'])
  outcome!: 'paid' | 'refused';

  @ApiPropertyOptional({
    description: 'Why URSSAF refused the debit. Kept on the failed payment.',
    example: 'Prélèvement rejeté par la banque.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
