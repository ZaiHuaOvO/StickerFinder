import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { BrowserContext, Page, chromium } from 'playwright';
import { BlockedError, ProviderError } from '../common/errors/provider.errors';
import { PlatformEnum } from '../common/enums';
import { envBool } from '../database/typeorm.config';
import { BrowserLockService } from './browser.lock';

const BLOCK_KEYWORDS = [
  '请完成验证',
  '安全验证',
  '滑动验证',
  '人机验证',
  '访问过于频繁',
  '访问异常',
  '异常访问',
  '操作过于频繁',
  '验证码',
  '安全限制',
  '当前网络存在风险',
  '访问被限制',
];

const ALLOWED_HOST_SUFFIXES = [
  'taobao.com',
  'tmall.com',
  'douyin.com',
  'jinritemai.com',
  'xiaohongshu.com',
  'xhslink.com',
  'pinduoduo.com',
  'yangkeduo.com',
];

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private readonly userDataDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly lock: BrowserLockService,
  ) {
    this.userDataDir = resolve(
      process.cwd(),
      this.config.get<string>('BROWSER_USER_DATA_DIR') ?? '.auth',
    );
    if (!existsSync(this.userDataDir)) {
      mkdirSync(this.userDataDir, { recursive: true });
    }
  }

  isEnabled(): boolean {
    return envBool(this.config.get<string>('BROWSER_PROVIDERS_ENABLED'), true);
  }

  isHeadless(): boolean {
    return envBool(this.config.get<string>('PLAYWRIGHT_HEADLESS'), false);
  }

  isBrowserInstalled(): boolean {
    try {
      return existsSync(chromium.executablePath());
    } catch {
      return false;
    }
  }

  async withPage<T>(
    platform: PlatformEnum,
    url: string,
    handler: (page: Page) => Promise<T>,
  ): Promise<T> {
    this.assertAllowedUrl(url);
    return this.lock.run(async () => {
      let context: BrowserContext | null = null;
      try {
        // 每个平台使用独立的持久化用户目录，扫码登录后下一次自动复用登录态。
        const platformDir = resolve(this.userDataDir, platform);
        if (!existsSync(platformDir)) {
          mkdirSync(platformDir, { recursive: true });
        }
        context = await chromium.launchPersistentContext(platformDir, {
          headless: this.isHeadless(),
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          viewport: { width: 1440, height: 900 },
          args: ['--disable-dev-shm-usage'],
        });
        const page = context.pages()[0] ?? (await context.newPage());
        page.setDefaultTimeout(30_000);
        page.setDefaultNavigationTimeout(45_000);
        this.logger.log(`[${platform}] 打开页面 ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return await handler(page);
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Executable doesn') || message.includes("doesn't exist")) {
          throw new ProviderError(
            'PLAYWRIGHT_NOT_INSTALLED',
            'Playwright Chromium 未安装，请先运行 npm run playwright:install',
          );
        }
        throw new ProviderError('BROWSER_ERROR', `浏览器采集失败：${message}`);
      } finally {
        if (context) {
          await context.close().catch((err: unknown) => {
            this.logger.warn(`关闭浏览器上下文失败：${String(err)}`);
          });
        }
      }
    });
  }

  async assertNotBlocked(page: Page): Promise<void> {
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 10_000 })
      .catch(() => '');
    const hit = BLOCK_KEYWORDS.find((keyword) => bodyText.includes(keyword));
    if (hit) {
      throw new BlockedError(
        'BLOCKED_BY_PLATFORM',
        `页面出现“${hit}”，已停止本平台采集，请人工在可见浏览器中处理后再试`,
      );
    }
  }

  async bodyText(page: Page): Promise<string> {
    return page
      .locator('body')
      .innerText({ timeout: 10_000 })
      .catch(() => '');
  }

  async pageTitle(page: Page): Promise<string> {
    return page.title().catch(() => '');
  }

  getProfileDir(platform: PlatformEnum): string {
    return resolve(this.userDataDir, platform);
  }

  private assertAllowedUrl(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ProviderError('BROWSER_URL_NOT_ALLOWED', '浏览器采集地址不合法');
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new ProviderError('BROWSER_URL_NOT_ALLOWED', '浏览器仅允许 http/https 地址');
    }
    const host = url.hostname.toLowerCase();
    const allowed = ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    if (!allowed) {
      throw new ProviderError(
        'BROWSER_URL_NOT_ALLOWED',
        `浏览器采集不允许访问该域名：${url.hostname}`,
      );
    }
  }
}
