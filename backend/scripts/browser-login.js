/* eslint-disable no-console */
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../.env')],
});

const { chromium } = require('playwright');
const fs = require('fs');

const LOGIN_URLS = {
  taobao: 'https://www.taobao.com',
  douyin: 'https://www.douyin.com',
  xiaohongshu: 'https://www.xiaohongshu.com',
  pinduoduo: 'https://www.pinduoduo.com',
};

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

function parseArgs(argv) {
  const platform = argv[2];
  let url = null;
  for (const arg of argv.slice(3)) {
    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length).trim();
    }
  }
  return { platform, url };
}

function validateUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('--url 不是合法地址');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('--url 仅允许 http/https');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!allowed) {
    throw new Error(`--url 不允许访问该域名：${parsed.hostname}`);
  }
  return parsed.toString();
}

async function main() {
  const { platform, url } = parseArgs(process.argv);
  if (!platform || !LOGIN_URLS[platform]) {
    console.error(
      '用法：npm run browser:login -- <taobao|douyin|xiaohongshu|pinduoduo> [--url=<登录或验证页面地址>]',
    );
    process.exitCode = 1;
    return;
  }
  const targetUrl = url ? validateUrl(url) : LOGIN_URLS[platform];

  const userDataDir = path.resolve(
    process.cwd(),
    process.env.BROWSER_USER_DATA_DIR ?? '.auth',
    platform,
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`为 ${platform} 打开可见浏览器。`);
  console.log('请在浏览器中手动完成登录或平台验证，完成后直接关闭浏览器窗口即可保存状态。');
  console.log(`目标地址：${targetUrl}`);
  console.log(`登录状态目录：${userDataDir}`);
  console.log(`
提示：搜索任务遇到验证码时，也可以直接在网页任务面板点击“打开验证浏览器”，
完成验证后点击“继续采集”。同一个用户数据目录不能同时被两个浏览器进程使用。`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL.trim() }
      : {}),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', () => {
      if (context.pages().length === 0) resolve();
    });
  });
  console.log('浏览器已关闭，状态已写入本地目录（该目录不会提交到 Git）。');
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('打开登录浏览器失败：', message);
  if (message.includes("Executable doesn't exist") || message.includes('Executable doesn')) {
    console.error('请先运行：npm run playwright:install');
  } else if (/SingletonLock|ProcessSingleton|user data dir(ectory)?.*(in use|already)|另一个程序正在使用/i.test(message)) {
    console.error(
      '该平台的用户数据目录正被另一个浏览器占用。请先关闭正在使用该目录的浏览器窗口（包括网页任务面板里打开的验证浏览器），再重试。',
    );
  }
  process.exitCode = 1;
});
