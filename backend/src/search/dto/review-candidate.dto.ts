import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewCandidateDto {
  @IsIn(['MATCH', 'NO_MATCH', 'PENDING'])
  decision: 'MATCH' | 'NO_MATCH' | 'PENDING';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
