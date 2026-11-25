import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Admin body for `PATCH /admin/chefs/:id/verification`.
 *
 * These two flags are the gate between a candidate and a bookable chef, and are
 * deliberately absent from every self-service DTO. For a chef who came through a
 * candidature, `isVerified: true` is granted by approving it, not here.
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
