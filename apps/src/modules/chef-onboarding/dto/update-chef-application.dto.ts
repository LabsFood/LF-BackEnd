import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';

import {
  ApplicationIdentityDto,
  CreateChefApplicationDto,
} from './create-chef-application.dto';

/** `identity` without `email`: the address is the account's own and never changes here. */
export class ApplicationIdentityUpdateDto extends OmitType(ApplicationIdentityDto, [
  'email',
] as const) {}

/**
 * Body of `PATCH /me/chef-application` — a candidate correcting their answers before a
 * decision.
 *
 * Every section is optional and replaces the stored one whole, so a section that is
 * sent is validated as at submission. `consent` is absent — it is kept verbatim as
 * proof — and so is `identity.email`: the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so a body carrying either is refused rather than ignored.
 */
export class UpdateChefApplicationDto extends PartialType(
  OmitType(CreateChefApplicationDto, ['identity', 'consent'] as const),
) {
  @ApiPropertyOptional({ type: ApplicationIdentityUpdateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApplicationIdentityUpdateDto)
  identity?: ApplicationIdentityUpdateDto;
}
