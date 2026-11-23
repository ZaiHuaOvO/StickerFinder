import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { resolve, sep } from 'path';
import { Repository } from 'typeorm';
import { ProductClassifierService } from '../ai/product-classifier.service';
import {
  ALL_PLATFORMS,
  ManualDecisionEnum,
  PlatformTaskStatusEnum,
  SearchRunStatusEnum,
} from '../common/enums';
import { PLATFORM_CHANNELS } from '../common/platform-channels';
import { ProductMatchResult, PlatformSearchTask, ProductCandidate, SearchRun } from '../entities';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { getReferenceImageDir } from '../uploads/uploads.util';
import { ReviewCandidateDto } from './dto/review-candidate.dto';
import { CreateSearchDto } from './dto/create-search.dto';
import {
  SearchDetailDto,
  toProductDto,
  toSearchDetailDto,
} from './dto/search-response.mapper';
import { SearchOrchestratorService } from './search-orchestrator.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: SearchOrchestratorService,
    private readonly registry: ProviderRegistryService,
    private readonly classifier: ProductClassifierService,
    @InjectRepository(SearchRun)
    private readonly runRepo: Repository<SearchRun>,
    @InjectRepository(PlatformSearchTask)
    private readonly taskRepo: Repository<PlatformSearchTask>,
    @InjectRepository(ProductCandidate)
    private readonly candidateRepo: Repository<ProductCandidate>,
    @InjectRepository(ProductMatchResult)
    private readonly matchRepo: Repository<ProductMatchResult>,
  ) {}

  async createSearch(dto: CreateSearchDto): Promise<{ searchId: string; status: string }> {
    const referenceImage = this.resolveReferenceImage(dto.referenceImageId);
    const aliases = [...new Set((dto.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];

    const run = this.runRepo.create({
      targetName: dto.targetName.trim(),
      seriesName: dto.seriesName?.trim() || null,
      aliases,
      referenceImage,
      status: SearchRunStatusEnum.RUNNING,
    });

    await this.runRepo.manager.transaction(async (manager) => {
      await manager.save(run);
      const tasks = PLATFORM_CHANNELS.map((channel) =>
        manager.create(PlatformSearchTask, {
          searchRunId: run.id,
          platform: channel.platform,
          provider: channel.provider,
          providerType: channel.providerType,
          status: PlatformTaskStatusEnum.PENDING,
        }),
      );
      await manager.save(tasks);
    });

    this.orchestrator.start(run.id);
    return { searchId: run.id, status: SearchRunStatusEnum.RUNNING };
  }

  async getSearch(id: string): Promise<SearchDetailDto> {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException('搜索任务不存在');
    }
    const tasks = await this.taskRepo.find({ where: { searchRunId: id } });

    const candidates = await this.candidateRepo.find({
      where: { searchRunId: id },
      relations: { matchResult: true, observations: true },
      order: { collectedAt: 'ASC' },
    });

    return toSearchDetailDto(run, tasks, candidates);
  }

  async listSearches(limit = 20) {
    const runs = await this.runRepo.find({
      order: { startedAt: 'DESC' },
      take: Math.min(50, Math.max(1, limit)),
    });
    return runs.map((run) => ({
      searchId: run.id,
      targetName: run.targetName,
      seriesName: run.seriesName,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorMessage: run.errorMessage,
    }));
  }

  async reviewCandidate(candidateId: string, dto: ReviewCandidateDto) {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
      relations: { matchResult: true, observations: true },
    });
    if (!candidate) {
      throw new NotFoundException('候选商品不存在');
    }
    if (!candidate.matchResult) {
      throw new NotFoundException('该商品还没有识别结果，无法人工复核');
    }
    const match = candidate.matchResult;
    match.manualDecision = dto.decision as ManualDecisionEnum;
    match.manualNote = dto.note?.trim() || null;
    match.reviewedAt = new Date();
    // 人工判断与 AI 原始判断分开保存，不覆盖 AI 字段
    await this.matchRepo.save(match);
    candidate.matchResult = match;
    return toProductDto(candidate);
  }

  getProviderStatuses() {
    return {
      ai: this.classifier.getStatus(),
      platforms: this.registry.getStatuses(),
    };
  }

  private resolveReferenceImage(referenceImageId?: string | null): string | null {
    if (!referenceImageId) return null;
    const dir = getReferenceImageDir(this.config);
    const absolute = resolve(dir, referenceImageId);
    if (!absolute.startsWith(dir + sep)) {
      throw new BadRequestException('参考图片路径不合法');
    }
    if (!existsSync(absolute)) {
      throw new BadRequestException('参考图片不存在，请重新上传');
    }
    return absolute;
  }
}
