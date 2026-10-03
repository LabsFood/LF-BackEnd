import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Matches, Max, Min } from 'class-validator';

import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../r2-storage.service';

const TYPES = Object.keys(PHOTO_TYPES);

export class PhotoUploadDto {
  @ApiProperty({ enum: TYPES, description: 'The picture’s type.', example: 'image/jpeg' })
  @IsIn(TYPES)
  contentType!: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_PHOTO_BYTES,
    description: `Its size in bytes, ${MAX_PHOTO_BYTES / (1024 * 1024)} MB at most.`,
    example: 482133,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_BYTES)
  sizeBytes!: number;
}

export class PhotoConfirmDto {
  @ApiProperty({
    description: 'The `uploadId` step 1 gave.',
    example: 'ph_9f2a1c4e7b30d85a61c2e4f7',
  })
  @Matches(/^ph_[a-f0-9]{24}$/)
  uploadId!: string;

  @ApiProperty({
    enum: TYPES,
    description: 'The same type as in step 1.',
    example: 'image/jpeg',
  })
  @IsIn(TYPES)
  contentType!: string;
}
