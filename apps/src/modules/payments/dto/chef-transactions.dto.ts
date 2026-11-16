import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class CollectCommissionsDto {
  @ApiProperty({
    description:
      'Commissions to bill on one facture B and debit. All of this batch cooker, ' +
      '`pending`, by direct debit, on a paid prestation (`collectable: true`).',
    example: ['5c1ebc99-9c0b-4ef8-bb6d-6bb9bd380a77'],
    maxItems: 100,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  commissionIds!: string[];
}
