import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SkuReviewDecisionDto {
  @IsString()
  @MaxLength(200)
  skuId: string;

  @IsIn(['TARGET', 'BUNDLE', 'EXCLUDED', 'PENDING'])
  decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED' | 'PENDING';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReviewCandidateDto {
  @IsOptional()
  @IsIn(['MATCH', 'NO_MATCH', 'PENDING'])
  decision?: 'MATCH' | 'NO_MATCH' | 'PENDING';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuReviewDecisionDto)
  skuDecisions?: SkuReviewDecisionDto[];
}
