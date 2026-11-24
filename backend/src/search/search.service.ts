import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { resolve, sep } from 'path';
import { Repository } from 'typeorm';
import { BrowserService } from '../browser/browser.service';
import {
  ALL_PLATFORMS,
  ManualDecisionEnum,
  PlatformEnum,
  PlatformTaskStatusEnum,
  ProviderKeyEnum,
  SearchRunStatusEnum,
  SourceSelectionModeEnum,
} from '../common/enums';
import { ProviderError } from '../common/errors/provider.errors';
import { channelsForMode } from '../common/platform-channels';
import { parseSourceMode } from '../common/utils/source-mode.util';
import {
  assertLiveSearchAllowed,
  liveRequestsEnabled,
  parseSearchDataMode,
} from '../common/utils/search-mode.util';
import { nowIso } from '../common/utils/date.util';
import {
  ProductMatchResult,
  PlatformSearchTask,
  ProductCandidate,
  ProductRuleResult,
  SearchRun,
} from '../entities';
import type { SkuManualDecision } from '../entities/product-match-result.entity';
import { Alibaba1688EveryInfraProvider } from '../providers/alibaba1688/alibaba1688-everyinfra.provider';
import { EveryInfraUsageService } from '../providers/everyinfra/everyinfra.usage.service';
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
    private readonly everyInfraUsage: EveryInfraUsageService,
    private readonly browser: BrowserService,
    @InjectRepository(SearchRun)
    private readonly runRepo: Repository<SearchRun>,
    @InjectRepository(PlatformSearchTask)
    private readonly taskRepo: Repository<PlatformSearchTask>,
    @InjectRepository(ProductCandidate)
    private readonly candidateRepo: Repository<ProductCandidate>,
    @InjectRepository(ProductMatchResult)
    private readonly matchRepo: Repository<ProductMatchResult>,
    @InjectRepository(ProductRuleResult)
    private readonly ruleRepo: Repository<ProductRuleResult>,
  ) {}

  async createSearch(dto: CreateSearchDto): Promise<{ searchId: string; status: string }> {
    assertLiveSearchAllowed(this.config);
    const referenceImage = this.resolveReferenceImage(dto.referenceImageId);
    const aliases = [...new Set((dto.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
    const seriesAliases = [
      ...new Set((dto.seriesAliases ?? []).map((alias) => alias.trim()).filter(Boolean)),
    ];
    const brandNames = [
      ...new Set((dto.brandNames ?? []).map((alias) => alias.trim()).filter(Boolean)),
    ];
    const selectedPlatforms = dto.platforms?.length ? new Set(dto.platforms) : null;

    const run = this.runRepo.create({
      targetName: dto.targetName.trim(),
      seriesName: dto.seriesName?.trim() || null,
      aliases,
      seriesAliases,
      brandNames,
      referenceImage,
      status: SearchRunStatusEnum.RUNNING,
    });

    await this.runRepo.manager.transaction(async (manager) => {
      await manager.save(run);
      const tasks = channelsForMode(this.sourceMode())
        .filter((channel) => !selectedPlatforms || selectedPlatforms.has(channel.platform))
        .map((channel) =>
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
      relations: {
        matchResult: true,
        ruleResult: true,
        observations: { promotions: true },
      },
      order: { collectedAt: 'ASC' },
    });

    const manualBrowserOpen: Partial<Record<PlatformEnum, boolean>> = {};
    for (const platform of ALL_PLATFORMS) {
      manualBrowserOpen[platform] = this.browser.isManualBrowserOpen(platform);
    }

    return toSearchDetailDto(run, tasks, candidates, manualBrowserOpen);
  }

  async cancelSearch(
    id: string,
  ): Promise<{ searchId: string; status: SearchRunStatusEnum }> {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException('搜索任务不存在');
    }

    const tasks = await this.taskRepo.find({ where: { searchRunId: id } });
    const platformsToRelease = [
      ...new Set(
        tasks
          .filter(
            (task) =>
              task.status ===
                PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION ||
              Boolean(task.manualVerification),
          )
          .map((task) => task.platform as PlatformEnum),
      ),
    ];

    const status = await this.orchestrator.cancel(id);
    for (const platform of platformsToRelease) {
      await this.browser.closeManualBrowser(platform).catch(() => undefined);
    }
    return {
      searchId: id,
      status: status ?? SearchRunStatusEnum.CANCELLED,
    };
  }

  /** 打开一个独立可见的浏览器窗口，让用户手动完成平台验证码/登录。 */
  async openVerificationBrowser(searchId: string, taskId: string) {
    const { task } = await this.requireWaitingTask(searchId, taskId);
    const state = task.manualVerification;
    if (!state?.targetUrl) {
      throw new BadRequestException('该任务缺少验证页面地址，无法打开验证浏览器');
    }
    try {
      const info = await this.browser.openManualBrowser(
        task.platform as PlatformEnum,
        state.targetUrl,
      );
      task.manualVerification = { ...state, openedAt: info.openedAt };
      await this.taskRepo.save(task);
      return {
        opened: true,
        url: info.url,
        profileDir: info.profileDir,
        openedAt: info.openedAt,
        alreadyOpen: info.alreadyOpen,
        message:
          '已打开独立可见浏览器。请在浏览器中完成平台提供的验证或登录；完成后回到本页面点击“继续采集”，系统会重新检查页面再继续采集。',
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new BadRequestException(`${error.code}：${error.message}`);
      }
      throw error;
    }
  }

  async closeVerificationBrowser(searchId: string, taskId: string) {
    const { task } = await this.requireWaitingTask(searchId, taskId);
    const closed = await this.browser.closeManualBrowser(task.platform as PlatformEnum);
    if (task.manualVerification) {
      task.manualVerification = { ...task.manualVerification, openedAt: null };
      await this.taskRepo.save(task);
    }
    return { closed };
  }

  /**
   * 关闭验证浏览器、把渠道恢复为 PENDING 并继续原搜索。
   * 恢复后由采集渠道重新加载页面并再次检查验证码/登录，不假定人工验证必然成功。
   */
  async resumeVerification(searchId: string, taskId: string) {
    assertLiveSearchAllowed(this.config);
    const { task, run } = await this.requireWaitingTask(searchId, taskId);

    // 同一个用户数据目录不能被两个浏览器进程同时使用。
    await this.browser.closeManualBrowser(task.platform as PlatformEnum);

    task.status = PlatformTaskStatusEnum.PENDING;
    task.errorCode = null;
    task.errorMessage = null;
    task.completedAt = null;
    if (task.manualVerification) {
      task.manualVerification = {
        ...task.manualVerification,
        openedAt: null,
        resumedAt: nowIso(),
      };
    }
    await this.taskRepo.save(task);

    run.status = SearchRunStatusEnum.RUNNING;
    run.completedAt = null;
    run.errorMessage = null;
    await this.runRepo.save(run);

    this.orchestrator.start(run.id);
    return {
      resumed: true,
      status: SearchRunStatusEnum.RUNNING,
      attempts: task.manualVerification?.attempts ?? 0,
      maxAttempts: task.manualVerification?.maxAttempts ?? 0,
      targetUrl: task.manualVerification?.targetUrl ?? null,
    };
  }

  private async requireWaitingTask(
    searchId: string,
    taskId: string,
  ): Promise<{ task: PlatformSearchTask; run: SearchRun }> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId, searchRunId: searchId },
    });
    if (!task) {
      throw new NotFoundException('采集渠道任务不存在');
    }
    if (task.provider !== ProviderKeyEnum.PLAYWRIGHT) {
      throw new BadRequestException('只有浏览器采集渠道支持人工验证');
    }
    if (task.status !== PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION) {
      throw new BadRequestException('该渠道当前不在等待人工验证状态');
    }
    const run = await this.runRepo.findOne({ where: { id: searchId } });
    if (!run) {
      throw new NotFoundException('搜索任务不存在');
    }
    return { task, run };
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
      relations: {
        matchResult: true,
        ruleResult: true,
        observations: { promotions: true },
      },
    });
    if (!candidate) {
      throw new NotFoundException('候选商品不存在');
    }
    const record = candidate.ruleResult ?? candidate.matchResult;
    if (!record) {
      throw new NotFoundException('该商品还没有识别结果，无法人工复核');
    }
    const hasSkuDecisions = Boolean(dto.skuDecisions?.length);
    if (!dto.decision && !hasSkuDecisions) {
      throw new BadRequestException('缺少人工判断');
    }

    if (dto.decision) {
      record.manualDecision = dto.decision as ManualDecisionEnum;
      record.manualNote = dto.note?.trim() || null;
    }

    if (hasSkuDecisions) {
      const knownSkuIds = new Set(
        (candidate.skuData ?? []).map(
          (sku, index) => sku.skuId ?? `sku-${index + 1}`,
        ),
      );
      const decisions = new Map(
        (record.manualSkuDecisions ?? []).map((item) => [item.skuId, item]),
      );
      const reviewedAt = new Date().toISOString();
      for (const item of dto.skuDecisions ?? []) {
        if (!knownSkuIds.has(item.skuId)) {
          throw new BadRequestException(`SKU 不存在：${item.skuId}`);
        }
        if (item.decision === 'PENDING') {
          decisions.delete(item.skuId);
          continue;
        }
        const decision: SkuManualDecision = {
          skuId: item.skuId,
          decision: item.decision,
          note: item.note?.trim() || null,
          reviewedAt,
        };
        decisions.set(item.skuId, decision);
      }
      record.manualSkuDecisions = [...decisions.values()];
    }

    record.reviewedAt = new Date();
    // 人工判断与规则结果分开保存，不覆盖规则字段。
    if (candidate.ruleResult) {
      candidate.ruleResult = await this.ruleRepo.save(candidate.ruleResult);
    } else if (candidate.matchResult) {
      candidate.matchResult = await this.matchRepo.save(candidate.matchResult);
    }
    return toProductDto(candidate);
  }

  getProviderStatuses() {
    const usage = this.everyInfraUsage.summary();
    return {
      searchMode: parseSearchDataMode(this.config.get<string>('SEARCH_DATA_MODE')),
      liveRequestsEnabled: liveRequestsEnabled(this.config),
      platforms: this.registry.getStatuses(),
      dataSourceMode: parseSourceMode(this.config.get<string>('DATA_SOURCE_MODE')),
      everyInfra: {
        totalCalls: usage.totalCalls,
        successfulCalls: usage.successfulCalls,
        failedCalls: usage.failedCalls,
        totalChargedUsd: usage.totalChargedUsd,
        byPlatform: usage.byPlatform,
      },
    };
  }

  getEveryInfraUsage() {
    return this.everyInfraUsage.summary();
  }

  /**
   * 用户主动触发的 1688 图搜。默认关闭；单次一张公网 HTTPS 图片。
   * 这里不会自动调用任何收费接口，只有显式请求才会执行。
   */
  async search1688ByImage(imageUrl: string) {
    assertLiveSearchAllowed(this.config);
    const provider = this.registry.get(
      PlatformEnum.ALIBABA1688,
      ProviderKeyEnum.EVERYINFRA_ALIBABA1688,
    );
    if (!(provider instanceof Alibaba1688EveryInfraProvider)) {
      throw new BadRequestException('1688 EveryInfra 渠道未注册');
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new BadRequestException('请提供公网可访问的 HTTPS 图片地址');
    }
    try {
      return await provider.searchByImage(imageUrl.trim());
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new BadRequestException(`${error.code}：${error.message}`);
      }
      throw error;
    }
  }

  private sourceMode() {
    return parseSourceMode(this.config.get<string>('DATA_SOURCE_MODE'));
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
