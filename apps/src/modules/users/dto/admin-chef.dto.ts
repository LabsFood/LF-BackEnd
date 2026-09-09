import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Admin vetting body for `PATCH /admin/chefs/:id/verification`.
 *
 * These two flags are the gate between a self-registered chef and a bookable one.
 * They are deliberately absent from every self-service DTO.
 */
export class UpdateChefVerificationDto {
  @ApiPropertyOptional({
    description:
      'Whether an admin has vetted this chef (identity, insurance, references).',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the chef is live and assignable to bookings.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
