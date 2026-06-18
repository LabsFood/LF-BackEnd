import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @Length(1, 128)
  clerkUserId!: string;

  @ApiProperty({ maxLength: 320 })
  @IsEmail()
  email!: string;

  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fullName?: string | null;
}