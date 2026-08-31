import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ClientProfileStatus } from '../../../generated/prisma/client';

/** Query string for `GET /admin/clients` — CRM status filter plus pagination. */
export class ListAdminClientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ClientProfileStatus,
    description: 'Optional CRM status filter.',
    example: ClientProfileStatus.active,
  })
  @IsOptional()
  @IsEnum(ClientProfileStatus)
  status?: ClientProfileStatus;
}
