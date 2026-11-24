import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SearchRunStatusEnum } from '../../common/enums';

export class SearchHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsEnum(SearchRunStatusEnum)
  status?: SearchRunStatusEnum;

  /** YYYY-MM-DD 或 ISO 8601 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  startTime?: string;

  /** YYYY-MM-DD 或 ISO 8601；只给日期时包含当天 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  endTime?: string;
}
