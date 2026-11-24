import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TargetDescriptor } from '../ai/product-classifier.service';
import {
  ALL_PLATFORMS,
  CandidateRelevanceEnum,
  MatchAssessmentEnum,
  MatchStatusEnum,
  PlatformEnum,
  PlatformTaskStatusEnum,
  PriceVerificationStatusEnum,
  ProviderErrorCodeEnum,
  ProviderKeyEnum,
  SearchRunStatusEnum,
  SkuVerificationStatusEnum,
  SourceSelectionModeEnum,
} from '../common/enums';
import {
  BlockedError,
  NotConfiguredError,
  ProviderError,
} from '../common/errors/provider.errors';
import { ManualVerificationState } from '../common/interfaces/manual-verification.interface';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import {
  SearchOptions,
  ProviderUsageStats,
  PlatformProvider,
} from '../common/interfaces/provider.interface';
import {
  PLATFORM_CHANNELS,
  channelsForPlatform,
  getChannelDefinition,
} from '../common/platform-channels';
import { nowIso } from '../common/utils/date.util';
import { normalizeTargetText } from '../common/utils/text.util';
import {
  decideManualVerification,
  isManualResolvableBlock,
  manualVerificationFailMessage,
} from '../common/utils/manual-verification.util';
import { parseSourceMode } from '../common/utils/source-mode.util';
import { computeRunOutcome } from '../common/utils/run-status.util';
import { normalizeProductUrl } from '../common/utils/url.util';
import { envInt } from '../database/typeorm.config';
import { PlatformSearchTask, ProductCandidate, SearchRun } from '../entities';
import { EveryInfraConfig } from '../providers/everyinfra/everyinfra.config';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import {
  AiMatchBudget,
  CandidateAggregationService,
} from './candidate-aggregation.service';

@Injectable()
export class SearchOrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly activeRuns = new Set<string>();
  private readonly cancelledRuns = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistryService,
    private readonly aggregation: CandidateAggregationService,
    private readonly everyInfraConfig: EveryInfraConfig,
    @InjectRepository(SearchRun)
    private readonly runRepo: Repository<SearchRun>,
    @InjectRepository(PlatformSearchTask)
    private readonly taskRepo: Repository<PlatformSearchTask>,
  ) {}

  /** 进程重启后，把未完成的任务标记为中断，不能假装成功 */
  async onApplicationBootstrap(): Promise<void> {
    const unfinishedRuns = await this.runRepo.find({
      where: [{ status: SearchRunStatusEnum.PENDING }, { status: SearchRunStatusEnum.RUNNING }],
    });
    for (const run of unfinishedRuns) {
      run.status = SearchRunStatusEnum.INTERRUPTED;
      run.errorMessage = '服务进程重启，搜索任务中断';
      run.completedAt = new Date();
      await this.runRepo.save(run);
    }

    const unfinishedTasks = await this.taskRepo.find({
      where: [
        { status: PlatformTaskStatusEnum.PENDING },
        { status: PlatformTaskStatusEnum.RUNNING },
      ],
    });
    for (const task of unfinishedTasks) {
      task.status = PlatformTaskStatusEnum.FAILED;
      task.errorCode = 'INTERRUPTED';
      task.errorMessage = '服务进程重启，平台采集中断';
      task.completedAt = new Date();
      await this.taskRepo.save(task);
    }

    // 等待人工验证的任务不随重启失败：登录态保存在 Profile 中，用户可重新打开验证浏览器继续。
    const waitingTasks = await this.taskRepo.find({
      where: { status: PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION },
    });
    for (const task of waitingTasks) {
      if (task.manualVerification) {
        task.manualVerification.openedAt = null;
      }
      task.note = this.appendNote(
        task.note,
        '服务进程已重启：此前的验证浏览器窗口已关闭，请重新点击“打开验证浏览器”完成验证后再继续采集。',
      );
      await this.taskRepo.save(task);
    }
    if (unfinishedRuns.length > 0 || unfinishedTasks.length > 0 || waitingTasks.length > 0) {
      this.logger.warn(
        `启动恢复：${unfinishedRuns.length} 个未完成搜索标记为中断，${unfinishedTasks.length} 个渠道任务标记为失败，${waitingTasks.length} 个渠道任务等待人工验证`,
      );
    }
  }

  start(searchId: string): void {
    this.cancelledRuns.delete(searchId);
    setImmediate(() => {
      void this.run(searchId).catch(async (error: unknown) => {
        this.logger.error(
          `搜索任务 ${searchId} 执行异常：${error instanceof Error ? error.message : String(error)}`,
        );
        await this.failRun(searchId, error).catch(() => undefined);
      });
    });
  }

  isCancelled(searchId: string): boolean {
    return this.cancelledRuns.has(searchId);
  }

  /**
   * 用户主动取消：保留已完成结果和已扣费记录，只停止后续平台搜索/AI/详情。
   * 已发出的第三方请求无法撤回或退费。
   */
  async cancel(searchId: string): Promise<SearchRunStatusEnum | null> {
    this.cancelledRuns.add(searchId);
    const run = await this.runRepo.findOne({ where: { id: searchId } });
    if (!run) return null;

    if (
      run.status === SearchRunStatusEnum.COMPLETED ||
      run.status === SearchRunStatusEnum.PARTIAL ||
      run.status === SearchRunStatusEnum.FAILED ||
      run.status === SearchRunStatusEnum.INTERRUPTED ||
      run.status === SearchRunStatusEnum.CANCELLED
    ) {
      return run.status;
    }

    run.status = SearchRunStatusEnum.CANCELLED;
    run.completedAt = new Date();
    run.errorMessage = null;
    await this.runRepo.save(run);

    const tasks = await this.taskRepo.find({ where: { searchRunId: searchId } });
    const unfinished = tasks.filter(
      (task) =>
        task.status === PlatformTaskStatusEnum.PENDING ||
        task.status === PlatformTaskStatusEnum.RUNNING ||
        task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION,
    );
    for (const task of unfinished) {
      task.status = PlatformTaskStatusEnum.CANCELLED;
      task.errorCode = ProviderErrorCodeEnum.CANCELLED;
      task.errorMessage = '用户主动取消搜索';
      task.completedAt = new Date();
      await this.taskRepo.save(task);
    }
    this.logger.warn(
      `搜索任务 ${searchId} 已取消（未完成渠道 ${unfinished.length} 个）`,
    );
    return SearchRunStatusEnum.CANCELLED;
  }

  private async run(searchId: string): Promise<void> {
    if (this.activeRuns.has(searchId)) {
      return;
    }
    this.activeRuns.add(searchId);
    try {
      const run = await this.runRepo.findOne({ where: { id: searchId } });
      if (!run) return;
      run.status = SearchRunStatusEnum.RUNNING;
      run.errorMessage = null;
      await this.runRepo.save(run);

      const tasks = await this.taskRepo.find({ where: { searchRunId: searchId } });
      const options = this.searchOptions();
      const mode = parseSourceMode(this.config.get<string>('DATA_SOURCE_MODE'));
      const target: TargetDescriptor = {
        name: run.targetName,
        seriesName: run.seriesName,
        aliases: run.aliases ?? [],
        seriesAliases: run.seriesAliases ?? [],
        brandNames: run.brandNames ?? [],
        referenceImagePath: run.referenceImage,
      };

      // 选中的平台各自独立执行：一个平台的搜索/AI/详情不阻塞其他平台。
      const selectedPlatforms = ALL_PLATFORMS.filter((platform) =>
        tasks.some((task) => task.platform === platform),
      );
      const results = await Promise.all(
        selectedPlatforms.map((platform) =>
          this.runPlatform(run, platform, tasks, target, options, mode),
        ),
      );
      const waitingForManualVerification = results.some(
        (result) => result.paused,
      );

      // 用户取消后不再覆盖 CANCELLED 状态。
      if (this.isCancelled(searchId)) {
        return;
      }

      if (waitingForManualVerification) {
        // 暂停而不是失败：保留已完成渠道与已采集候选，等待用户完成验证后继续。
        run.status = SearchRunStatusEnum.WAITING_MANUAL_VERIFICATION;
        run.errorMessage = null;
        run.completedAt = null;
        await this.runRepo.save(run);
        this.logger.warn(`搜索任务 ${searchId} 暂停，等待人工完成浏览器验证`);
        return;
      }

      const finalTasks = await this.taskRepo.find({
        where: { searchRunId: searchId },
      });
      const outcome = computeRunOutcome(finalTasks);
      run.status = outcome.status;
      run.errorMessage = outcome.errorMessage;
      run.completedAt = new Date();
      await this.runRepo.save(run);
    } finally {
      this.activeRuns.delete(searchId);
    }
  }

  private async runPlatform(
    run: SearchRun,
    platform: PlatformEnum,
    allTasks: PlatformSearchTask[],
    target: TargetDescriptor,
    options: SearchOptions,
    mode: SourceSelectionModeEnum,
  ): Promise<{ paused: boolean }> {
    const platformTasks = this.orderPlatformTasks(allTasks, platform);
    if (platformTasks.length === 0) return { paused: false };
    if (this.isCancelled(run.id)) return { paused: false };

    const candidates = await this.aggregation.loadCandidates(run.id, platform);
    // 同款判断预算按平台独立计算，避免一个平台耗尽全部预算。
    const aiBudget: AiMatchBudget = {
      remaining: Math.max(
        0,
        envInt(
          this.config.get<string>('THIRD_PARTY_MAX_AI_MATCHES_PER_PLATFORM'),
          6,
        ),
      ),
    };

    try {
      let paused = false;
      for (const task of platformTasks) {
        if (this.isCancelled(run.id)) return { paused: false };
        // 恢复采集时只重跑未结束的渠道，已成功的来源不重复请求、不重复计费。
        if (this.isTerminalTask(task)) continue;
        await this.runChannel(
          run,
          task,
          target,
          options,
          platform,
          candidates,
          aiBudget,
          allTasks,
        );
        if (task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION) {
          paused = true;
          break;
        }
        if (
          options.requestDelayMs > 0 &&
          task !== platformTasks[platformTasks.length - 1]
        ) {
          await this.sleep(options.requestDelayMs);
        }
      }

      if (!paused && mode === SourceSelectionModeEnum.FALLBACK) {
        paused = await this.runFallbackChannels(
          run,
          platform,
          platformTasks,
          target,
          options,
          candidates,
          aiBudget,
        );
      }

      // 等待人工验证时不在本平台继续识别；恢复后重新进入本方法。
      if (paused) return { paused: true };
      if (this.isCancelled(run.id)) return { paused: false };

      try {
        const classification = await this.aggregation.classifyPending(
          run.id,
          platform,
          target,
          this.aiClassifyConcurrency(),
          () => this.isCancelled(run.id),
        );
        if (classification.classified > 0 || classification.failed > 0) {
          this.logger.log(
            `[${platform}] AI 识别完成：成功 ${classification.classified}，失败 ${classification.failed}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[${platform}] AI 识别阶段异常：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (this.isCancelled(run.id)) return { paused: false };

      // 详情优先级依赖分类后的 matchResult，必须重新加载候选，不能使用分类前快照。
      const enrichedCandidates = await this.aggregation.loadCandidates(
        run.id,
        platform,
      );
      await this.enrichDetails(
        run.id,
        platform,
        platformTasks,
        enrichedCandidates,
        target,
      );
      return { paused: false };    } catch (error) {
      // 平台之间互相隔离：一个平台异常不取消其他平台。
      this.logger.error(
        `[${platform}] 平台流程异常：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { paused: false };
    }
  }

  private aiClassifyConcurrency(): number {
    return Math.min(
      5,
      Math.max(
        1,
        envInt(this.config.get<string>('AI_CLASSIFY_CONCURRENCY'), 3),
      ),
    );
  }

  private async runChannel(
    run: SearchRun,
    task: PlatformSearchTask,
    target: TargetDescriptor,
    options: SearchOptions,
    platform: PlatformEnum,
    candidates: Awaited<ReturnType<CandidateAggregationService['loadCandidates']>>,
    aiBudget: AiMatchBudget,
    allTasks: PlatformSearchTask[],
  ): Promise<void> {
    const provider = this.registry.get(task.platform, task.provider);
    task.providerType = provider.providerType;
    task.resultCount = 0;
    task.errorCode = null;
    task.errorMessage = null;
    task.note = null;

    if (!provider.isConfigured()) {
      const status = provider.getStatus();
      task.status = PlatformTaskStatusEnum.NOT_CONFIGURED;
      task.errorCode = 'PROVIDER_NOT_CONFIGURED';
      task.errorMessage = status.reason ?? '该来源尚未配置可用的数据';
      task.completedAt = new Date();
      await this.taskRepo.save(task);
      return;
    }

    task.status = PlatformTaskStatusEnum.RUNNING;
    task.startedAt = new Date();
    task.completedAt = null;
    await this.taskRepo.save(task);

    try {
      const result = await provider.search(run.targetName, options);
      this.applyUsageStats(task, result.usage);
      if (this.isCancelled(run.id)) {
        task.status = PlatformTaskStatusEnum.CANCELLED;
        task.errorCode = ProviderErrorCodeEnum.CANCELLED;
        task.errorMessage = '用户主动取消搜索';
        task.completedAt = new Date();
        await this.taskRepo.save(task);
        return;
      }
      const deduped = this.dedupeProducts(result.products);
      const warnings = result.warnings ?? [];
      task.note = warnings.length > 0 ? warnings.join('\n') : null;
      // 采集成功说明人工处理有效，清除恢复信息。
      task.manualVerification = null;

      if (deduped.length === 0) {
        task.status = PlatformTaskStatusEnum.EMPTY;
        task.resultCount = 0;
        task.completedAt = new Date();
        await this.taskRepo.save(task);
        return;
      }

      let saved = 0;
      let productErrors = 0;
      for (const product of deduped) {
        if (this.isCancelled(run.id)) break;
        try {
          await this.aggregation.ingest(
            run.id,
            platform,
            product,
            task,
            candidates,
            aiBudget,
          );
          saved += 1;
        } catch (error) {
          productErrors += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[${task.provider}] 保存/合并商品失败：${message}`,
          );
          if (!task.errorMessage) {
            task.errorMessage = `部分商品处理失败：${message}`;
          }
        }
      }

      if (this.isCancelled(run.id)) {
        task.status = PlatformTaskStatusEnum.CANCELLED;
        task.errorCode = ProviderErrorCodeEnum.CANCELLED;
        task.errorMessage = '用户主动取消搜索';
        task.resultCount = saved;
        task.completedAt = new Date();
        await this.taskRepo.save(task);
        return;
      }

      task.resultCount = saved;
      if (saved > 0) {
        task.status =
          productErrors > 0
            ? PlatformTaskStatusEnum.PARTIAL_SUCCESS
            : PlatformTaskStatusEnum.SUCCESS;
      } else {
        task.status = PlatformTaskStatusEnum.FAILED;
        task.errorCode = 'CANDIDATE_PERSIST_FAILED';
        task.errorMessage = task.errorMessage ?? '商品结果未能写入数据库';
      }
      task.completedAt = new Date();
      await this.taskRepo.save(task);
    } catch (error) {
      if (this.isCancelled(run.id)) {
        task.status = PlatformTaskStatusEnum.CANCELLED;
        task.errorCode = ProviderErrorCodeEnum.CANCELLED;
        task.errorMessage = '用户主动取消搜索';
        task.completedAt = new Date();
        await this.taskRepo.save(task);
        return;
      }
      if (
        error instanceof BlockedError &&
        task.provider === ProviderKeyEnum.PLAYWRIGHT &&
        isManualResolvableBlock(error.code)
      ) {
        await this.pauseForManualVerification(run, task, error, allTasks);
        return;
      }

      task.completedAt = new Date();
      task.manualVerification = null;
      if (error instanceof NotConfiguredError) {
        task.status = PlatformTaskStatusEnum.NOT_CONFIGURED;
        task.errorCode = error.code;
        task.errorMessage = error.message;
      } else if (error instanceof BlockedError) {
        task.status = PlatformTaskStatusEnum.BLOCKED;
        task.errorCode = error.code;
        task.errorMessage = error.message;
      } else if (error instanceof ProviderError) {
        task.status = PlatformTaskStatusEnum.FAILED;
        task.errorCode = error.code;
        const details = error.details?.trim();
        task.errorMessage = details
          ? `${error.message}（${details.slice(0, 300)}）`
          : error.message;
      } else {
        task.status = PlatformTaskStatusEnum.FAILED;
        task.errorCode = 'INTERNAL_ERROR';
        task.errorMessage = error instanceof Error ? error.message : String(error);
      }
      this.logger.warn(
        `[${task.platform}/${task.provider}] 采集结束：${task.status} ${
          task.errorCode ?? ''
        } ${task.errorMessage ?? ''}`,
      );
      await this.taskRepo.save(task);
    }
  }

  private applyUsageStats(
    task: PlatformSearchTask,
    usage: ProviderUsageStats | undefined,
  ): void {
    if (!usage) return;
    task.apiRequestCount = (task.apiRequestCount ?? 0) + usage.apiRequestCount;
    if (typeof usage.chargedUsd === 'number') {
      task.chargedUsd =
        Math.round(((task.chargedUsd ?? 0) + usage.chargedUsd) * 1_000_000) /
        1_000_000;
    }
    if (usage.requestIds.length > 0) {
      task.lastRequestId = usage.requestIds[usage.requestIds.length - 1];
    }
  }

  /**
   * FALLBACK：主数据源未配置/失败/被拦截时，按渠道顺序逐个尝试备用来源。
   * 每个渠道最多一次；有空结果或成功结果即停止；人工验证暂停时不继续换源。
   */
  private async runFallbackChannels(
    run: SearchRun,
    platform: PlatformEnum,
    platformTasks: PlatformSearchTask[],
    target: TargetDescriptor,
    options: SearchOptions,
    candidates: Awaited<ReturnType<CandidateAggregationService['loadCandidates']>>,
    aiBudget: AiMatchBudget,
  ): Promise<boolean> {
    const allTasks = await this.taskRepo.find({
      where: { searchRunId: run.id },
    });
    const attempted = new Set(platformTasks.map((task) => String(task.provider)));
    const channels = channelsForPlatform(platform);

    for (const channel of channels) {
      if (attempted.has(String(channel.provider))) continue;
      if (this.platformHasUsableResult(platformTasks)) return false;
      attempted.add(String(channel.provider));

      const definition = getChannelDefinition(platform, channel.provider);
      const task = this.taskRepo.create({
        searchRunId: run.id,
        platform,
        provider: channel.provider,
        providerType: definition?.providerType ?? channel.providerType,
        status: PlatformTaskStatusEnum.PENDING,
      });
      await this.taskRepo.save(task);
      platformTasks.push(task);
      this.logger.log(
        `[${platform}] 主数据源不可用，FALLBACK 到 ${channel.provider}`,
      );

      await this.runChannel(
        run,
        task,
        target,
        options,
        platform,
        candidates,
        aiBudget,
        allTasks,
      );
      allTasks.push(task);

      if (task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION) {
        return true;
      }
      if (options.requestDelayMs > 0) {
        await this.sleep(options.requestDelayMs);
      }
    }
    return false;
  }

  private platformHasUsableResult(tasks: PlatformSearchTask[]): boolean {
    return tasks.some(
      (task) =>
        task.status === PlatformTaskStatusEnum.SUCCESS ||
        task.status === PlatformTaskStatusEnum.PARTIAL_SUCCESS ||
        task.status === PlatformTaskStatusEnum.EMPTY,
    );
  }

  /**
   * 详情补充：每平台每轮最多 N（硬上限 3）个，优先 AI 判定 HIGH 的候选；
   * 详情失败只写备注，不改变原搜索结果与任务状态。
   */
  private async enrichDetails(
    searchRunId: string,
    platform: PlatformEnum,
    platformTasks: PlatformSearchTask[],
    candidates: Awaited<ReturnType<CandidateAggregationService['loadCandidates']>>,
    target: TargetDescriptor,
  ): Promise<void> {
    if (!this.everyInfraConfig.detailEnabled) return;
    const limit = this.everyInfraConfig.detailMaxPerPlatform;
    if (limit <= 0) return;

    const normalizedTokens = [
      target.name,
      target.seriesName,
      ...target.aliases,
      ...(target.seriesAliases ?? []),
      ...(target.brandNames ?? []),
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map(normalizeTargetText);
    const normalize = normalizeTargetText;

    // 优先选择标题/系列/款式证据明确的候选，而不是机械取前 N 条。
    const ranked = candidates
      .map((candidate) => {
        const match = candidate.matchResult;
        let priority = 0;
        if (!match) {
          priority = 0;
        } else if (
          match.matchStatus === MatchStatusEnum.NO_MATCH ||
          match.candidateRelevance === CandidateRelevanceEnum.NONE ||
          match.categoryMatch === MatchAssessmentEnum.CONFLICT
        ) {
          priority = -1;
        } else {
          const titleMatchesTarget = normalizedTokens.some((token) =>
            normalize(candidate.title).includes(token),
          );
          if (match.candidateRelevance === CandidateRelevanceEnum.HIGH) {
            priority =
              match.targetItemMatch === MatchAssessmentEnum.MATCH ? 3 : 2;
          } else if (match.candidateRelevance === CandidateRelevanceEnum.MEDIUM) {
            priority = titleMatchesTarget ? 2 : 1;
          } else if (match.candidateRelevance === CandidateRelevanceEnum.LOW) {
            priority = titleMatchesTarget ? 1 : 0;
          }
        }
        return { candidate, priority };
      })
      .filter((entry) => entry.priority > 0)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (b.candidate.matchResult?.confidence ?? -1) -
            (a.candidate.matchResult?.confidence ?? -1),
      );

    const selected: Array<{
      candidate: ProductCandidate;
      task: PlatformSearchTask;
      provider: PlatformProvider & {
        fetchDetail: NonNullable<PlatformProvider['fetchDetail']>;
      };
    }> = [];

    for (const { candidate } of ranked) {
      for (const task of platformTasks) {
        if (
          task.status !== PlatformTaskStatusEnum.SUCCESS &&
          task.status !== PlatformTaskStatusEnum.PARTIAL_SUCCESS
        ) {
          continue;
        }
        const provider = this.registry.get(platform, task.provider);
        if (!provider.fetchDetail) continue;
        const observations = candidate.observations ?? [];
        if (!observations.some((obs) => obs.provider === provider.key)) continue;
        if (
          observations.some(
            (obs) =>
              obs.provider === provider.key &&
              obs.matchReason === 'detail_enrichment',
          )
        ) {
          continue;
        }
        selected.push({
          candidate,
          task,
          provider: provider as PlatformProvider & {
            fetchDetail: NonNullable<PlatformProvider['fetchDetail']>;
          },
        });
        break;
      }
      if (selected.length >= limit) break;
    }

    const queue = [...selected];
    const concurrency = Math.min(
      this.everyInfraConfig.detailConcurrency,
      queue.length,
    );
    await Promise.all(
      Array.from({ length: concurrency }, () =>
        this.runDetailQueue(queue, searchRunId, target),
      ),
    );
  }

  private async runDetailQueue(
    queue: Array<{
      candidate: ProductCandidate;
      task: PlatformSearchTask;
      provider: PlatformProvider & {
        fetchDetail: NonNullable<PlatformProvider['fetchDetail']>;
      };
    }>,
    searchRunId: string,
    target: TargetDescriptor,
  ): Promise<void> {
    while (queue.length > 0) {
      if (this.isCancelled(searchRunId)) break;
      const entry = queue.shift();
      if (!entry) break;
      await this.enrichOneDetail(searchRunId, entry, target);
    }
  }

  private async enrichOneDetail(
    searchRunId: string,
    entry: {
      candidate: ProductCandidate;
      task: PlatformSearchTask;
      provider: PlatformProvider & {
        fetchDetail: NonNullable<PlatformProvider['fetchDetail']>;
      };
    },
    target: TargetDescriptor,
  ): Promise<void> {
    if (this.isCancelled(searchRunId)) return;
    try {
      const detail = await entry.provider.fetchDetail(
        this.aggregation.representative(entry.candidate),
      );
      this.applyUsageStats(entry.task, detail.usage);
      if (!detail.product) {
        await this.aggregation.updateVerificationStatus(
          entry.candidate,
          SkuVerificationStatusEnum.FAILED,
          PriceVerificationStatusEnum.UNVERIFIED,
          `详情暂不可用：${(detail.warnings ?? []).join('；') || '详情接口未返回商品'}`,
        );
        if (detail.warnings?.length) {
          entry.task.note = this.appendNote(
            entry.task.note,
            `详情补充：${detail.warnings.join('；')}`,
          );
        }
        return;
      }

      await this.aggregation.recordDetail(
        searchRunId,
        entry.task,
        entry.candidate,
        detail.product,
      );

      const hasNewEvidence =
        (detail.product.skuOptions?.length ?? 0) > 0 ||
        Boolean(detail.product.description);
      if (hasNewEvidence) {
        const outcome = await this.aggregation.reclassifyCandidate(
          entry.candidate,
          target,
        );
        this.logger.log(
          `[${entry.task.platform}/${entry.task.provider}] 详情后识别：${outcome.aiStatus} ${outcome.matchStatus}，SKU=${outcome.skuVerificationStatus}，价格=${outcome.priceVerificationStatus}`,
        );
      } else {
        await this.aggregation.updateVerificationStatus(
          entry.candidate,
          SkuVerificationStatusEnum.NOT_AVAILABLE,
          PriceVerificationStatusEnum.UNVERIFIED,
          '详情接口未返回 SKU 或描述',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.aggregation
        .updateVerificationStatus(
          entry.candidate,
          SkuVerificationStatusEnum.FAILED,
          PriceVerificationStatusEnum.UNVERIFIED,
          `详情暂不可用：${message}`,
        )
        .catch(() => undefined);
      entry.task.note = this.appendNote(
        entry.task.note,
        `详情补充失败（原搜索结果保留）：${message}`,
      );
      this.logger.warn(
        `[${entry.task.platform}/${entry.task.provider}] 详情补充失败：${message}`,
      );
    } finally {
      await this.taskRepo.save(entry.task);
    }
  }

  /**
   * 验证码/登录拦截：保存关键词、目标 URL、Profile 与进度，转为等待人工验证。
   * 超过尝试上限时明确失败，不自动破解、不无限重试。
   */  private async pauseForManualVerification(
    run: SearchRun,
    task: PlatformSearchTask,
    error: BlockedError,
    allTasks: PlatformSearchTask[],
  ): Promise<boolean> {
    const maxAttempts = this.maxManualAttempts();
    const decision = decideManualVerification(
      task.manualVerification?.attempts ?? 0,
      maxAttempts,
    );
    const targetUrl =
      error.browserUrl ?? task.manualVerification?.targetUrl ?? '';
    const profileDir =
      error.profileDir ?? task.manualVerification?.profileDir ?? '';

    if (decision.action === 'FAIL' || !targetUrl) {
      task.status = PlatformTaskStatusEnum.FAILED;
      task.errorCode = error.code;
      task.completedAt = new Date();
      task.errorMessage =
        decision.action === 'FAIL'
          ? `${error.message} ${manualVerificationFailMessage(decision.attempts, maxAttempts)}`
          : `${error.message} 无法保存验证页面地址，不能继续人工验证。`;
      this.logger.warn(
        `[${task.platform}/${task.provider}] 人工验证无法恢复：${task.errorMessage}`,
      );
      await this.taskRepo.save(task);
      return false;
    }

    const state: ManualVerificationState = {
      keyword: run.targetName,
      targetUrl,
      profileDir,
      attempts: decision.attempts,
      maxAttempts,
      lastErrorCode: error.code,
      lastErrorMessage: error.message,
      requestedAt: nowIso(),
      openedAt: null,
      resumedAt: task.manualVerification?.resumedAt ?? null,
      progress: this.buildProgress(allTasks, task),
    };
    task.status = PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION;
    task.errorCode = error.code;
    task.errorMessage = error.message;
    task.manualVerification = state;
    task.completedAt = null;
    await this.taskRepo.save(task);
    this.logger.warn(
      `[${task.platform}/${task.provider}] 暂停等待人工验证（第 ${decision.attempts}/${maxAttempts} 次）：${error.message}`,
    );
    return true;
  }

  private buildProgress(
    allTasks: PlatformSearchTask[],
    current: PlatformSearchTask,
  ): ManualVerificationState['progress'] {
    const completedPlatforms = ALL_PLATFORMS.filter(
      (platform) =>
        platform !== current.platform &&
        allTasks
          .filter((task) => task.platform === platform)
          .every((task) => this.isTerminalTask(task)),
    );
    return {
      completedTasks: allTasks.filter((task) => this.isTerminalTask(task)).length,
      totalTasks: allTasks.length,
      completedPlatforms,
      remainingPlatforms: ALL_PLATFORMS.filter(
        (platform) =>
          platform !== current.platform && !completedPlatforms.includes(platform),
      ),
    };
  }

  private isTerminalTask(task: PlatformSearchTask): boolean {
    return (
      task.status === PlatformTaskStatusEnum.SUCCESS ||
      task.status === PlatformTaskStatusEnum.PARTIAL_SUCCESS ||
      task.status === PlatformTaskStatusEnum.EMPTY ||
      task.status === PlatformTaskStatusEnum.FAILED ||
      task.status === PlatformTaskStatusEnum.NOT_CONFIGURED ||
      task.status === PlatformTaskStatusEnum.BLOCKED ||
      task.status === PlatformTaskStatusEnum.CANCELLED
    );
  }

  private maxManualAttempts(): number {
    return Math.max(
      1,
      Math.min(
        10,
        envInt(this.config.get<string>('BROWSER_MANUAL_VERIFICATION_MAX_ATTEMPTS'), 3),
      ),
    );
  }

  private appendNote(note: string | null, line: string): string {
    return note ? `${note}\n${line}` : line;
  }

  private orderPlatformTasks(
    tasks: PlatformSearchTask[],
    platform: PlatformEnum,
  ): PlatformSearchTask[] {
    const order = PLATFORM_CHANNELS.filter((channel) => channel.platform === platform).map(
      (channel) => channel.provider,
    );
    return tasks
      .filter((task) => task.platform === platform)
      .sort((a, b) => {
        const left = order.indexOf(a.provider as ProviderKeyEnum);
        const right = order.indexOf(b.provider as ProviderKeyEnum);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      });
  }

  private dedupeProducts(products: NormalizedProduct[]): NormalizedProduct[] {
    const seen = new Set<string>();
    const result: NormalizedProduct[] = [];
    for (const product of products) {
      const key =
        product.platformProductId !== undefined
          ? `${product.platform}:id:${product.platformProductId}`
          : `${product.platform}:url:${normalizeProductUrl(product.productUrl)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(product);
    }
    return result;
  }

  private searchOptions(): SearchOptions {
    return {
      maxResults: Math.min(
        50,
        Math.max(1, envInt(this.config.get<string>('SEARCH_MAX_RESULTS_PER_PLATFORM'), 20)),
      ),
      maxPages: Math.min(5, Math.max(1, envInt(this.config.get<string>('SEARCH_MAX_PAGES'), 2))),
      requestDelayMs: Math.max(
        0,
        envInt(this.config.get<string>('PLATFORM_REQUEST_DELAY_MS'), 2000),
      ),
    };
  }

  private async failRun(searchId: string, error: unknown): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: searchId } });
    if (!run) return;
    run.status = SearchRunStatusEnum.FAILED;
    run.errorMessage = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date();
    await this.runRepo.save(run);
    const tasks = await this.taskRepo.find({ where: { searchRunId: searchId } });
    for (const task of tasks) {
      if (
        task.status === PlatformTaskStatusEnum.PENDING ||
        task.status === PlatformTaskStatusEnum.RUNNING
      ) {
        task.status = PlatformTaskStatusEnum.FAILED;
        task.errorCode = 'SEARCH_RUN_FAILED';
        task.errorMessage = '搜索任务异常终止';
        task.completedAt = new Date();
        await this.taskRepo.save(task);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
