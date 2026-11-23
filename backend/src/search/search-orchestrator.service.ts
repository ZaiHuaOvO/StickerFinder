import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TargetDescriptor } from '../ai/product-classifier.service';
import {
  ALL_PLATFORMS,
  PlatformEnum,
  PlatformTaskStatusEnum,
  ProviderKeyEnum,
  SearchRunStatusEnum,
} from '../common/enums';
import {
  BlockedError,
  NotConfiguredError,
  ProviderError,
} from '../common/errors/provider.errors';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SearchOptions } from '../common/interfaces/provider.interface';
import { PLATFORM_CHANNELS } from '../common/platform-channels';
import { normalizeProductUrl } from '../common/utils/url.util';
import { envInt } from '../database/typeorm.config';
import { PlatformSearchTask, SearchRun } from '../entities';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import {
  AiMatchBudget,
  CandidateAggregationService,
} from './candidate-aggregation.service';

@Injectable()
export class SearchOrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistryService,
    private readonly aggregation: CandidateAggregationService,
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
    if (unfinishedRuns.length > 0 || unfinishedTasks.length > 0) {
      this.logger.warn(
        `启动恢复：${unfinishedRuns.length} 个未完成搜索标记为中断，${unfinishedTasks.length} 个渠道任务标记为失败`,
      );
    }
  }

  start(searchId: string): void {
    setImmediate(() => {
      void this.run(searchId).catch(async (error: unknown) => {
        this.logger.error(
          `搜索任务 ${searchId} 执行异常：${error instanceof Error ? error.message : String(error)}`,
        );
        await this.failRun(searchId, error).catch(() => undefined);
      });
    });
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
      const aiBudget: AiMatchBudget = {
        remaining: Math.max(
          0,
          envInt(this.config.get<string>('THIRD_PARTY_MAX_AI_MATCHES_PER_PLATFORM'), 6),
        ),
      };
      const target: TargetDescriptor = {
        name: run.targetName,
        seriesName: run.seriesName,
        aliases: run.aliases ?? [],
        referenceImagePath: run.referenceImage,
      };

      for (let index = 0; index < ALL_PLATFORMS.length; index += 1) {
        const platform = ALL_PLATFORMS[index];
        const platformTasks = this.orderPlatformTasks(tasks, platform);
        if (platformTasks.length === 0) continue;

        const candidates = await this.aggregation.loadCandidates(run.id, platform);
        for (const task of platformTasks) {
          await this.runChannel(run, task, target, options, platform, candidates, aiBudget);
          if (options.requestDelayMs > 0 && task !== platformTasks[platformTasks.length - 1]) {
            await this.sleep(options.requestDelayMs);
          }
        }

        try {
          const classification = await this.aggregation.classifyPending(
            run.id,
            platform,
            target,
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

        if (index < ALL_PLATFORMS.length - 1 && options.requestDelayMs > 0) {
          await this.sleep(options.requestDelayMs);
        }
      }

      run.status = SearchRunStatusEnum.COMPLETED;
      run.completedAt = new Date();
      await this.runRepo.save(run);
    } finally {
      this.activeRuns.delete(searchId);
    }
  }

  private async runChannel(
    run: SearchRun,
    task: PlatformSearchTask,
    target: TargetDescriptor,
    options: SearchOptions,
    platform: PlatformEnum,
    candidates: Awaited<ReturnType<CandidateAggregationService['loadCandidates']>>,
    aiBudget: AiMatchBudget,
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
      const deduped = this.dedupeProducts(result.products);
      const warnings = result.warnings ?? [];
      task.note = warnings.length > 0 ? warnings.join('\n') : null;

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
      task.completedAt = new Date();
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
