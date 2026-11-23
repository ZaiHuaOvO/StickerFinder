import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSearchDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  targetName: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  seriesName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}\.(png|jpe?g|webp|gif)$/i, {
    message: '参考图片 ID 格式不正确',
  })
  referenceImageId?: string | null;
}
