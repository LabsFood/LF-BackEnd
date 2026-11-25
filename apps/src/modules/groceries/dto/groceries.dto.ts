import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Recettes lot 6: what the grocery routes take. */

export class StartCardDto {
  @ApiProperty({
    description: 'Where Stripe sends the client back once the card is saved.',
  })
  @IsString()
  @MaxLength(2048)
  successUrl!: string;

  @ApiProperty({
    description: 'Where Stripe sends the client back if they leave the page.',
  })
  @IsString()
  @MaxLength(2048)
  cancelUrl!: string;
}

export class ConfirmCardDto {
  @ApiProperty({
    description: 'The setup page the client comes back from.',
    example: 'cs_test_…',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId!: string;
}

export class CancelGroceriesDto {
  @ApiPropertyOptional({ maxLength: 500, example: 'Je ferai les courses moi-même.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class GroceriesNoticeDto {
  @ApiProperty({
    description:
      'When the batch cooker shops: after the lock (T-48h), before the prestation.',
    example: '2026-12-09T09:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  shoppingAt!: Date;

  @ApiProperty({
    description:
      'Until when the client may cancel: at least the minimum notice of the console ' +
      '(2 h at first) after now, and before the groceries. The server clock rules.',
    example: '2026-12-08T20:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  cancelDeadline!: Date;
}

export class ReceiptUploadDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType!: string;

  @ApiProperty({ minimum: 1, maximum: 10_485_760, example: 812_000 })
  @IsInt()
  @Min(1)
  @Max(10_485_760)
  sizeBytes!: number;
}

export class DepositedReceiptDto {
  @ApiProperty({ description: 'From the upload URL step.', example: 'up_3f9a…' })
  @IsString()
  @Matches(/^up_[a-f0-9]{24}$/)
  uploadId!: string;

  @ApiProperty({
    description: 'When the receipt was paid.',
    example: '2026-12-09T09:40:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  purchasedAt!: Date;
}

export class ReceiptLineDto {
  @ApiProperty({ maxLength: 160, example: 'Poulet fermier 1,6 kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label!: string;

  @ApiProperty({ minimum: 1, maximum: 100_000, example: 1_890 })
  @IsInt()
  @Min(1)
  @Max(100_000)
  amountCents!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Index of its receipt in `receipts`. Null: a line without a receipt, not ' +
      'reimbursed unless the client agrees.',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  receipt?: number | null;
}

export class SubmitReceiptsDto {
  @ApiProperty({ type: [DepositedReceiptDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DepositedReceiptDto)
  receipts!: DepositedReceiptDto[];

  @ApiProperty({ type: [ReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];

  @ApiPropertyOptional({
    description:
      'An instant payout of the reimbursement, its fee at the batch cooker’s charge ' +
      '(`GET /pricing-rules` → `groceries.instantPayoutFeeBps`).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  instantPayout?: boolean;
}

export class ContestLineDto {
  @ApiProperty({ maxLength: 1000, example: 'Ce produit n’était pas sur ma liste.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class DecideLineDto {
  @ApiProperty({ enum: ['upheld', 'rejected'] })
  @IsIn(['upheld', 'rejected'])
  decision!: 'upheld' | 'rejected';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class DisputeFaultDto {
  @ApiProperty({
    enum: ['chef', 'client', 'platform'],
    description:
      '`chef`: the transfer is taken back; `client`: recovered by hand; `platform`: ' +
      'written off.',
  })
  @IsIn(['chef', 'client', 'platform'])
  fault!: 'chef' | 'client' | 'platform';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class DisputeRecoveredDto {
  @ApiProperty({ maxLength: 255, example: 'Virement du 12/01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reference!: string;
}

export class StatementQueryDto {
  @ApiProperty({ example: '2026-12', description: 'The month, YYYY-MM.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}
