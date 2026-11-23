import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductClassifierService, TargetDescriptor } from '../ai/product-classifier.service';
import {
  ALL_PLATFORMS,
  PlatformTaskStatusEnum,
  SearchRunStatusEnum,
} from '../common/enums';
import {
  BlockedError,
  NotConfiguredError,
  ProviderError,
} from '../common/errors/provider.errors';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SearchOptions } from '../common/interfaces/provider.interface';
import { normalizeProductUrl } from '../common/utils/url.util';
import { envInt } from '../database/typeorm.config';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  SearchRun,
} from '../entities';
import { ProviderRegistryService } from '../providers/provider-registry.service';

@Injectable()
export class SearchOrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly config: ConfigService,
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
        `启动恢复：${unfinishedRuns.length} 个未完成搜索标记为中断，${unfinishedTasks.length} 个平台任务标记为失败`,
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

      const tasks = await this.taskRepo.find({
        where: { searchRunId: searchId },
      });
      const ordered = ALL_PLATFORMS.map((platform) =>
        tasks.find((task) => task.platform === platform),
      ).filter((task): task is PlatformSearchTask => Boolean(task));

      const options = this.searchOptions();
      const target: TargetDescriptor = {
        name: run.targetName,
        seriesName: run.seriesName,
        aliases: run.aliases ?? [],
        referenceImagePath: run.referenceImage,
      };

      for (const task of ordered) {
        await this.runPlatform(run, task, target, options);
        if (task !== ordered[ordered.length - 1] && options.requestDelayMs > 0) {
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

  private async runPlatform(
    run: SearchRun,
    task: PlatformSearchTask,
    target: TargetDescriptor,
    options: SearchOptions,
  ): Promise<void> {
    const provider = this.registry.get(task.platform);
    task.providerType = provider.isConfigured() ? provider.providerType : null;
    task.resultCount = 0;
    task.errorCode = null;
    task.errorMessage = null;
    task.note = null;

    if (!provider.isConfigured()) {
      const status = provider.getStatus();
      task.status = PlatformTaskStatusEnum.NOT_CONFIGURED;
      task.errorCode = 'PROVIDER_NOT_CONFIGURED';
      task.errorMessage = status.reason ?? '该平台尚未配置可用的数据来源';
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
      const deduped = this.dedupe(result.products);
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
      for (const product of deduped) {
        try {
          const candidate = await this.persistCandidate(run.id, product);
          await this.classifyCandidate(candidate, product, target);
          saved += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`保存/识别候选商品失败：${message}`);
          if (!task.errorMessage) {
            task.errorMessage = `部分商品处理失败：${message}`;
          }
        }
      }

      task.resultCount = saved;
      task.status =
        saved > 0 ? PlatformTaskStatusEnum.SUCCESS : PlatformTaskStatusEnum.FAILED;
      if (saved === 0 && !task.errorCode) {
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
        `[${task.platform}] 采集结束：${task.status} ${task.errorCode ?? ''} ${task.errorMessage ?? ''}`,
      );
      await this.taskRepo.save(task);
    }
  }

  private async persistCandidate(
    searchRunId: string,
    product: NormalizedProduct,
  ): Promise<ProductCandidate> {
    const candidate = this.candidateRepo.create({
      searchRunId,
      platform: product.platform,
      platformProductId: product.platformProductId?.slice(0, 200) ?? null,
      title: product.title.slice(0, 500),
      shopName: product.shopName ? product.shopName.slice(0, 250) : null,
      productUrl: product.productUrl,
      imageUrls: product.imageUrls.slice(0, 10),
      description: product.description ?? null,
      skuData: product.skuOptions ?? [],
      priceData: product.price ?? null,
      groupPriceData: product.groupPrice ?? null,
      sourceType: product.sourceType,
      rawData: product.rawData ?? null,
      collectedAt: this.toDate(product.collectedAt),
    });
    return this.candidateRepo.save(candidate);
  }

  private async classifyCandidate(
    candidate: ProductCandidate,
    product: NormalizedProduct,
    target: TargetDescriptor,
  ): Promise<void> {
    const outcome = await this.classifier.classify(target, product, candidate.id);
    const match = this.matchRepo.create({
      candidateId: candidate.id,
      matchStatus: outcome.matchStatus,
      matchType: outcome.matchType,
      confidence: outcome.confidence,
      summary: outcome.summary,
      reason: outcome.reason,
      matchedContents: outcome.matchedContents,
      matchedSkuIds: outcome.matchedSkuIds,
      skuDecisions: outcome.skuDecisions,
      evidence: outcome.evidence,
      aiStatus: outcome.aiStatus,
      aiModel: outcome.model,
      aiRawResponse: outcome.rawResponse,
      aiError: outcome.error,
      needsManualReview: outcome.needsManualReview,
      classifiedAt: new Date(),
    });
    await this.matchRepo.save(match);
  }

  private dedupe(products: NormalizedProduct[]): NormalizedProduct[] {
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

  private toDate(value: string): Date {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
