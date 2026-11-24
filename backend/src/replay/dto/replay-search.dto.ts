import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PlatformEnum } from '../../common/enums';

export class ReplaySearchDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  fixtureId: string;

  /** 不填时使用测试数据自身的名称 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetName?: string;

  /** 显式传空字符串表示不使用系列关键词 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  seriesName?: string;

  @IsOptional()
  @IsArray()
  @Type(() => String)
  aliases?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => String)
  seriesAliases?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => String)
  brandNames?: string[];

  /** 只回放选中的平台；不填表示全部 */
  @IsOptional()
  @IsArray()
  @IsEnum(PlatformEnum, { each: true })
  platforms?: PlatformEnum[];
}
