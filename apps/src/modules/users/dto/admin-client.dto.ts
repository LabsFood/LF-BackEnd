import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ClientProfileStatus } from '../../../generated/prisma/client';

/**
 * CRM statuses in the order a client moves through them. Set by admins only: no
 * code changes a status on its own.
 */
export const CLIENT_STATUSES = ['prospect', 'active', 'vip', 'inactive'] as const;
export const CLIENT_STATUS_HELP =
  '`prospect`: not a customer yet. `active`: a current client, the default. `vip`: a ' +
  'client to look after first. `inactive`: no longer orders. Admins set it by hand.';

/** Query string for `GET /admin/clients` — CRM status filter plus pagination. */
export class ListAdminClientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: CLIENT_STATUSES,
    description: `Keep only clients with this status. ${CLIENT_STATUS_HELP}`,
    example: ClientProfileStatus.active,
  })
  @IsOptional()
  @IsEnum(ClientProfileStatus)
  status?: ClientProfileStatus;
}
