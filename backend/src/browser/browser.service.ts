import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { BrowserContext, Page, chromium } from 'playwright';
import {
  BlockedError,
  NotConfiguredError,
  ProviderError,
} from '../common/errors/provider.errors';
import { PlatformEnum, ProviderErrorCodeEnum } from '../common/enums';
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

interface ManualBrowserSession {
  platform: PlatformEnum;
  context: BrowserContext;
  page: Page;
  url: string;
  openedAt: string;
  profileDir: string;
}

export interface ManualBrowserSessionInfo {
  platform: PlatformEnum;
  url: string;
  profileDir: string;
  openedAt: string;
  alreadyOpen: boolean;
}

@Injectable()
export class BrowserService {
  private readonly logger = new Logger(BrowserService.name);
  private readonly userDataDir: string;
  private readonly manualSessions = new Map<PlatformEnum, ManualBrowserSession>();

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

  getChannel(): string | undefined {
    const channel = (this.config.get<string>('PLAYWRIGHT_CHANNEL') ?? '').trim();
    return channel || undefined;
  }

  isBrowserInstalled(): boolean {
    const channel = this.getChannel();
    if (channel === 'chrome') {
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ].some((candidate) => existsSync(candidate));
    }
    if (channel === 'msedge') {
      return [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/microsoft-edge',
      ].some((candidate) => existsSync(candidate));
    }
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
      let page: Page | null = null;
      const platformDir = this.ensureProfileDir(platform);
      if (this.manualSessions.has(platform)) {
        // 同一个用户数据目录不能被两个浏览器进程同时使用。
        throw new ProviderError(
          ProviderErrorCodeEnum.BROWSER_PROFILE_BUSY,
          `平台 ${platform} 的人工验证浏览器仍占用用户数据目录；请先在任务面板点击“继续采集”（会自动关闭验证浏览器）或关闭验证浏览器后再采集。`,
        );
      }
      try {
        context = await this.launchPersistent(platformDir, this.isHeadless());
        page = context.pages()[0] ?? (await context.newPage());
        page.setDefaultTimeout(30_000);
        page.setDefaultNavigationTimeout(45_000);
        this.logger.log(`[${platform}] 打开页面 ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return await handler(page);
      } catch (error) {
        if (error instanceof BlockedError) {
          // 把被拦截时的真实页面地址与用户目录带给上层，用于人工验证与恢复。
          error.browserUrl = error.browserUrl ?? page?.url() ?? url;
          error.profileDir = error.profileDir ?? platformDir;
          throw error;
        }
        if (error instanceof ProviderError) {
          throw error;
        }
        throw this.toLaunchError(error, platformDir);
      } finally {
        if (context) {
          await context.close().catch((err: unknown) => {
            this.logger.warn(`关闭浏览器上下文失败：${String(err)}`);
          });
        }
      }
    });
  }

  /**
   * 打开一个独立的、始终可见的浏览器窗口，使用与自动采集相同的持久化登录目录。
   * 该窗口不会在请求结束时关闭，由用户手动完成平台验证后再点击“继续采集”。
   */
  async openManualBrowser(
    platform: PlatformEnum,
    url: string,
  ): Promise<ManualBrowserSessionInfo> {
    this.assertAllowedUrl(url);
    if (!this.isEnabled()) {
      throw new NotConfiguredError('浏览器采集通道已关闭（BROWSER_PROVIDERS_ENABLED=false）');
    }
    if (!this.isBrowserInstalled()) {
      throw new ProviderError(
        ProviderErrorCodeEnum.PLAYWRIGHT_NOT_INSTALLED,
        'Playwright Chromium 未安装，请先运行 npm run playwright:install',
      );
    }

    return this.lock.run(async () => {
      const existing = this.manualSessions.get(platform);
      if (existing) {
        const page = existing.page;
        if (existing.url !== url && !page.isClosed()) {
          await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((error: unknown) => {
            this.logger.warn(`[${platform}] 验证浏览器跳转失败：${String(error)}`);
          });
          existing.url = page.url() || url;
        }
        await page.bringToFront().catch(() => undefined);
        return this.toSessionInfo(existing, true);
      }

      const platformDir = this.ensureProfileDir(platform);
      let context: BrowserContext | null = null;
      try {
        // 人工验证必须可见；Playwright 无法把运行中的 headless 上下文改为 headed。
        context = await this.launchPersistent(platformDir, false);
        const page = context.pages()[0] ?? (await context.newPage());
        page.setDefaultTimeout(30_000);
        page.setDefaultNavigationTimeout(45_000);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const session: ManualBrowserSession = {
          platform,
          context,
          page,
          url: page.url() || url,
          openedAt: new Date().toISOString(),
          profileDir: platformDir,
        };
        this.manualSessions.set(platform, session);
        context.on('close', () => {
          if (this.manualSessions.get(platform)?.context === context) {
            this.manualSessions.delete(platform);
            this.logger.log(`[${platform}] 人工验证浏览器已关闭`);
          }
        });
        this.logger.log(`[${platform}] 已打开人工验证浏览器：${session.url}`);
        return this.toSessionInfo(session, false);
      } catch (error) {
        if (context) {
          await context.close().catch(() => undefined);
        }
        throw this.toLaunchError(error, platformDir);
      }
    });
  }

  async closeManualBrowser(platform: PlatformEnum): Promise<boolean> {
    const session = this.manualSessions.get(platform);
    if (!session) return false;
    // 先关闭并释放用户数据目录，再移除会话；期间 withPage 仍会看到会话并返回 BROWSER_PROFILE_BUSY。
    await this.lock.run(async () => {
      await session.context.close().catch((error: unknown) => {
        this.logger.warn(`[${platform}] 关闭人工验证浏览器失败：${String(error)}`);
      });
      if (this.manualSessions.get(platform)?.context === session.context) {
        this.manualSessions.delete(platform);
      }
    });
    return true;
  }

  getManualBrowserInfo(platform: PlatformEnum): ManualBrowserSessionInfo | null {
    const session = this.manualSessions.get(platform);
    return session ? this.toSessionInfo(session, true) : null;
  }

  isManualBrowserOpen(platform: PlatformEnum): boolean {
    return this.manualSessions.has(platform);
  }

  async assertNotBlocked(page: Page): Promise<void> {
    const title = await this.pageTitle(page);
    const bodyText = await this.pageText(page);
    const titleHit = ['验证码', '安全验证', '访问异常', 'captcha'].find((keyword) =>
      title.toLowerCase().includes(keyword.toLowerCase()),
    );
    const bodyHit = BLOCK_KEYWORDS.find((keyword) => bodyText.includes(keyword));
    const hit = titleHit ?? bodyHit;
    if (hit) {
      const captcha = hit.includes('验证码') || hit.toLowerCase().includes('captcha');
      throw new BlockedError(
        captcha
          ? ProviderErrorCodeEnum.CAPTCHA_REQUIRED
          : ProviderErrorCodeEnum.BLOCKED_BY_PLATFORM,
        captcha
          ? '页面返回验证码/人机验证，已暂停该渠道；请打开验证浏览器人工完成验证后点击“继续采集”。本项目不会自动破解或绕过验证码。'
          : `页面出现“${hit}”，已停止本平台采集，请人工在可见浏览器中处理后再试`,
      );
    }
  }

  async bodyText(page: Page): Promise<string> {
    return this.pageText(page);
  }

  private async pageText(page: Page): Promise<string> {
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

  private ensureProfileDir(platform: PlatformEnum): string {
    // 每个平台使用独立的持久化用户目录，避免不同平台的登录态互相覆盖。
    const platformDir = this.getProfileDir(platform);
    if (!existsSync(platformDir)) {
      mkdirSync(platformDir, { recursive: true });
    }
    return platformDir;
  }

  private launchPersistent(profileDir: string, headless: boolean): Promise<BrowserContext> {
    const channel = this.getChannel();
    return chromium.launchPersistentContext(profileDir, {
      headless,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1440, height: 900 },
      args: ['--disable-dev-shm-usage'],
      ...(channel ? { channel: channel as 'chrome' | 'msedge' } : {}),
    });
  }

  private toSessionInfo(
    session: ManualBrowserSession,
    alreadyOpen: boolean,
  ): ManualBrowserSessionInfo {
    return {
      platform: session.platform,
      url: session.url,
      profileDir: session.profileDir,
      openedAt: session.openedAt,
      alreadyOpen,
    };
  }

  private toLaunchError(error: unknown, profileDir: string): ProviderError {
    if (error instanceof ProviderError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable doesn') || message.includes("doesn't exist")) {
      return new ProviderError(
        ProviderErrorCodeEnum.PLAYWRIGHT_NOT_INSTALLED,
        'Playwright Chromium 未安装，请先运行 npm run playwright:install',
      );
    }
    if (this.isProfileBusyMessage(message)) {
      return new ProviderError(
        ProviderErrorCodeEnum.BROWSER_PROFILE_BUSY,
        `浏览器用户目录正被另一个浏览器进程占用：${profileDir}。请先关闭正在使用该目录的浏览器窗口（包括 npm run browser:login 打开的窗口），再重试。`,
        message,
      );
    }
    return new ProviderError(
      ProviderErrorCodeEnum.BROWSER_ERROR,
      `浏览器采集失败：${message}`,
    );
  }

  private isProfileBusyMessage(message: string): boolean {
    return /SingletonLock|ProcessSingleton|Failed to create a ProcessSingleton|user data dir(ectory)?.*(in use|already)|profile.*(in use|already in use)|另一个程序正在使用/i.test(
      message,
    );
  }

  private assertAllowedUrl(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ProviderError(
        ProviderErrorCodeEnum.BROWSER_URL_NOT_ALLOWED,
        '浏览器采集地址不合法',
      );
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new ProviderError(
        ProviderErrorCodeEnum.BROWSER_URL_NOT_ALLOWED,
        '浏览器仅允许 http/https 地址',
      );
    }
    const host = url.hostname.toLowerCase();
    const allowed = ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    if (!allowed) {
      throw new ProviderError(
        ProviderErrorCodeEnum.BROWSER_URL_NOT_ALLOWED,
        `浏览器采集不允许访问该域名：${url.hostname}`,
      );
    }
  }
}
