import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_BODY_LENGTH,
  MAX_MESSAGE_PAGE_SIZE,
} from '../domain/messaging.rules';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
} from '../services/messaging-storage.service';

/** Body of `POST /me/conversations`. */
export class OpenConversationDto {
  @ApiProperty({
    description:
      'A booking of the caller, as its client or as its batch cooker. The thread ' +
      'is the one between those two people: a second booking returns the same one.',
    example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  })
  @IsUUID()
  bookingId!: string;
}

/** Body of `POST /admin/conversations/support`. */
export class OpenSupportConversationDto {
  @ApiProperty({
    description: 'The client or batch cooker the team wants to write to.',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsUUID()
  userId!: string;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'The `nextCursor` of the previous page, to load older messages. Omit for the ' +
      'latest ones.',
    example: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_MESSAGE_PAGE_SIZE,
    default: DEFAULT_MESSAGE_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGE_PAGE_SIZE)
  limit?: number;
}

export class AttachmentRefDto {
  @ApiProperty({
    description:
      'The `uploadId` returned by `attachments/upload-url`, once the file is sent.',
    example: 'up_9f2a1c4e7b30d85a61c2e4f7',
  })
  @IsString()
  @Length(1, 64)
  uploadId!: string;

  @ApiProperty({
    description: 'The file name on the device, shown back in the thread.',
    example: 'liste-de-courses.pdf',
  })
  @IsString()
  @Length(1, 255)
  fileName!: string;
}

/** Body of `POST .../conversations/:id/messages`. */
export class SendMessageDto {
  @ApiPropertyOptional({
    description: 'The text. May be empty when at least one file is attached.',
    maxLength: MAX_BODY_LENGTH,
    example: 'Bonjour ! Est-ce que vous pouvez prévoir un plat sans gluten ?',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY_LENGTH)
  body?: string;

  @ApiPropertyOptional({
    description:
      'An id chosen by the device for this message. Sending it again returns the ' +
      'message already stored, so a retry after a network error never posts twice.',
    example: '3f6c2a1e-8f0b-4c53-9a44-1c2d5e7f9b10',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  clientMessageId?: string;

  @ApiPropertyOptional({
    type: [AttachmentRefDto],
    description: `Files already uploaded, ${MAX_ATTACHMENTS_PER_MESSAGE} at most.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => AttachmentRefDto)
  attachments?: AttachmentRefDto[];
}

/** Body of `.../conversations/:id/attachments/upload-url`. */
export class CreateAttachmentUploadDto {
  // Shape only: the accepted types and the size cap answer 422 from
  // `MessagingStorageService.assertAcceptable`, as for KYC documents.
  @ApiProperty({
    enum: ALLOWED_ATTACHMENT_TYPES,
    description: 'The file type. PDF, JPEG, PNG or WebP; anything else answers 422.',
    example: 'image/jpeg',
  })
  @IsString()
  mimeType!: string;

  @ApiProperty({
    description: 'The file size in bytes. 10 MB at most, or 422.',
    example: 842133,
    maximum: MAX_ATTACHMENT_BYTES,
  })
  @IsInt()
  sizeBytes!: number;
}

export const ADMIN_CONVERSATION_FILTERS = ['unread', 'flagged'] as const;
export const CONVERSATION_TYPES = ['chef_client', 'support'] as const;

export class AdminListConversationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: CONVERSATION_TYPES,
    description:
      '`support`: the inbox of the team. `chef_client`: the threads between a ' +
      'client and a batch cooker.',
  })
  @IsOptional()
  @IsIn(CONVERSATION_TYPES)
  type?: (typeof CONVERSATION_TYPES)[number];

  @ApiPropertyOptional({
    enum: ADMIN_CONVERSATION_FILTERS,
    description:
      '`unread`: support threads the team has not opened. `flagged`: threads where a ' +
      'phone number or an email was detected and not yet dismissed.',
  })
  @IsOptional()
  @IsIn(ADMIN_CONVERSATION_FILTERS)
  filter?: (typeof ADMIN_CONVERSATION_FILTERS)[number];
}
