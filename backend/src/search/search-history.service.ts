import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ALL_PLATFORMS,
  ManualDecisionEnum,
  MatchStatusEnum,
  PlatformEnum,
} from '../common/enums';
import {
  PlatformSearchTask,
  ProductCandidate,
  SearchRun,
} from '../entities';
import { SearchHistoryQueryDto } from './dto/search-history-query.dto';

export interface SearchHistoryItemDto {
  searchId: string;
  /** 本次实际用于搜索的关键词 */
  keyword: string;
  targetName: string;
  seriesName: string | null;
  status: string;
  platforms: PlatformEnum[];
  productCount: number;
  matchedCount: number;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface SearchHistoryPageDto {
  items: SearchHistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

function parseStart(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('开始时间格式不正确，请使用 YYYY-MM-DD');
  }
  return date;
}

function parseEnd(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('结束时间格式不正确，请使用 YYYY-MM-DD');
  }
  return date;
}

@Injectable()
export class SearchHistoryService {
  constructor(
    @InjectRepository(SearchRun)
    private readonly runRepo: Repository<SearchRun>,
    @InjectRepository(PlatformSearchTask)
    private readonly taskRepo: Repository<PlatformSearchTask>,
    @InjectRepository(ProductCandidate)
    private readonly candidateRepo: Repository<ProductCandidate>,
  ) {}

  /** 只查询数据库，不触发任何外部采集请求。 */
  async list(query: SearchHistoryQueryDto): Promise<SearchHistoryPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.runRepo
      .createQueryBuilder('run')
      .orderBy('run.startedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const keyword = query.keyword?.trim();
    if (keyword) {
      // 转义 LIKE 通配符，避免用户输入的 % / _ 变成宽泛匹配。
      const escaped = keyword.replace(/[\\%_]/g, '\\$&');
      qb.andWhere(
        "(run.targetName LIKE :keyword ESCAPE '\\' OR run.seriesName LIKE :keyword ESCAPE '\\')",
        { keyword: `%${escaped}%` },
      );
    }
    if (query.status) {
      qb.andWhere('run.status = :status', { status: query.status });
    }
    if (query.startTime) {
      qb.andWhere('run.startedAt >= :startTime', {
        startTime: parseStart(query.startTime),
      });
    }
    if (query.endTime) {
      qb.andWhere('run.startedAt <= :endTime', {
        endTime: parseEnd(query.endTime),
      });
    }

    const [runs, total] = await qb.getManyAndCount();
    if (runs.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const ids = runs.map((run) => run.id);
    const [tasks, productCounts, matchedCounts] = await Promise.all([
      this.taskRepo.find({ where: { searchRunId: In(ids) } }),
      this.productCounts(ids),
      this.matchedCounts(ids),
    ]);

    const platformsByRun = new Map<string, Set<PlatformEnum>>();
    for (const task of tasks) {
      const set = platformsByRun.get(task.searchRunId) ?? new Set<PlatformEnum>();
      set.add(task.platform);
      platformsByRun.set(task.searchRunId, set);
    }

    return {
      items: runs.map((run) => ({
        searchId: run.id,
        keyword: run.targetName,
        targetName: run.targetName,
        seriesName: run.seriesName,
        status: run.status,
        platforms: ALL_PLATFORMS.filter((platform) =>
          platformsByRun.get(run.id)?.has(platform),
        ),
        productCount: productCounts.get(run.id) ?? 0,
        matchedCount: matchedCounts.get(run.id) ?? 0,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
      })),
      total,
      page,
      pageSize,
    };
  }

  private async productCounts(runIds: string[]): Promise<Map<string, number>> {
    const rows = await this.candidateRepo
      .createQueryBuilder('candidate')
      .select('candidate.search_run_id', 'runId')
      .addSelect('COUNT(*)', 'count')
      .where('candidate.search_run_id IN (:...runIds)', { runIds })
      .groupBy('candidate.search_run_id')
      .getRawMany<{ runId: string; count: string }>();
    return new Map(rows.map((row) => [row.runId, Number(row.count) || 0]));
  }

  /** 人工判断优先于 AI 判断，与详情页的有效匹配状态保持一致。 */
  private async matchedCounts(runIds: string[]): Promise<Map<string, number>> {
    const rows = await this.candidateRepo
      .createQueryBuilder('candidate')
      .innerJoin('product_match_results', 'mr', 'mr.candidate_id = candidate.id')
      .select('candidate.search_run_id', 'runId')
      .addSelect('COUNT(*)', 'count')
      .where('candidate.search_run_id IN (:...runIds)', { runIds })
      .andWhere(
        `CASE
          WHEN mr.manual_decision = :manualMatch THEN :match
          WHEN mr.manual_decision = :manualNoMatch THEN :noMatch
          ELSE mr.match_status
        END = :match`,
        {
          manualMatch: ManualDecisionEnum.MATCH,
          manualNoMatch: ManualDecisionEnum.NO_MATCH,
          match: MatchStatusEnum.MATCH,
          noMatch: MatchStatusEnum.NO_MATCH,
        },
      )
      .groupBy('candidate.search_run_id')
      .getRawMany<{ runId: string; count: string }>();
    return new Map(rows.map((row) => [row.runId, Number(row.count) || 0]));
  }
}
