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

async function main() {
  const platform = process.argv[2];
  if (!platform || !LOGIN_URLS[platform]) {
    console.error('用法：npm run browser:login -- <taobao|douyin|xiaohongshu|pinduoduo>');
    process.exitCode = 1;
    return;
  }

  const userDataDir = path.resolve(
    process.cwd(),
    process.env.BROWSER_USER_DATA_DIR ?? '.auth',
    platform,
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`为 ${platform} 打开可见浏览器。`);
  console.log('请在浏览器中手动完成登录（扫码或账号密码），登录成功后直接关闭浏览器窗口即可保存登录状态。');
  console.log(`登录状态目录：${userDataDir}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(LOGIN_URLS[platform], { waitUntil: 'domcontentloaded' });

  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', () => {
      if (context.pages().length === 0) resolve();
    });
  });
  console.log('浏览器已关闭，登录状态已写入本地目录（该目录不会提交到 Git）。');
}

main().catch(async (error) => {
  console.error('打开登录浏览器失败：', error.message);
  if (String(error.message).includes("Executable doesn't exist") || String(error.message).includes('Executable doesn')) {
    console.error('请先运行：npm run playwright:install');
  }
  process.exitCode = 1;
});
