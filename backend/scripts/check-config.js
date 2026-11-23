/* eslint-disable no-console */
/**
 * 配置自检：
 *   node scripts/check-config.js         只检查配置是否存在、数据库与浏览器是否可用
 *   node scripts/check-config.js --live  额外发起真实的 DeepSeek / 淘宝 / 拼多多请求
 *
 * 说明：
 * - 不会打印任何密钥、密码、Cookie 或完整请求参数。
 * - --live 会消耗少量平台/API 额度，请确认已在 .env 中配置相应凭证。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dotenv = require('dotenv');
dotenv.config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../.env')],
});

const axios = require('axios');
const { chromium } = require('playwright');

const LIVE = process.argv.includes('--live');
const results = [];

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const tag = `[${status}]`.padEnd(16);
  console.log(`${tag} ${name}${detail ? `：${detail}` : ''}`);
}

function value(name) {
  return (process.env[name] ?? '').trim();
}

function checkPresence(name, hint) {
  const v = value(name);
  if (!v) {
    record(name, 'EMPTY', hint ?? '未设置');
    return false;
  }
  record(name, 'SET', `已设置（${v.length} 字符，内容不显示）`);
  return true;
}

function checkOptional(name, fallback) {
  const v = value(name);
  if (!v) {
    record(name, 'DEFAULT', fallback);
    return false;
  }
  record(name, 'SET', `已设置（${v.length} 字符，内容不显示）`);
  return true;
}

function formatTaobaoTimestamp() {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function signTop(params, secret) {
  const keys = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== '')
    .sort();
  const joined = keys.map((key) => `${key}${params[key]}`).join('');
  return crypto
    .createHash('md5')
    .update(`${secret}${joined}${secret}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

async function checkDatabase() {
  const dbType = (value('DB_TYPE') || 'mysql').toLowerCase();
  if (dbType === 'sqlite') {
    const file = path.resolve(process.cwd(), value('SQLITE_PATH') || 'data/sticker-finder.sqlite');
    if (!fs.existsSync(file)) {
      record('SQLite', 'MISSING', '数据库文件尚不存在，后端启动时会自动创建');
      return;
    }
    try {
      const Database = require('better-sqlite3');
      const db = new Database(file, { readonly: true, fileMustExist: true });
      const tables = db
        .prepare("select name from sqlite_master where type='table' order by name")
        .all()
        .map((row) => row.name);
      db.close();
      record('SQLite', 'OK', `${file}（${tables.length} 张表）`);
    } catch (error) {
      record('SQLite', 'FAIL', error.message);
    }
    return;
  }

  const mysql = require('mysql2/promise');
  const database = value('DB_DATABASE') || 'sticker_finder';
  let connection = null;
  try {
    connection = await mysql.createConnection({
      host: value('DB_HOST') || '127.0.0.1',
      port: Number(value('DB_PORT') || 3306),
      user: value('DB_USERNAME') || 'root',
      password: value('DB_PASSWORD'),
      database,
      connectTimeout: 5000,
    });
    const [rows] = await connection.query('select version() as version');
    record('MySQL', 'OK', `已连接 ${database}（MySQL ${rows[0]?.version ?? 'unknown'}）`);
  } catch (error) {
    if (error.code === 'ER_BAD_DB_ERROR') {
      record('MySQL', 'FAIL', `数据库 ${database} 不存在，请先运行 npm run db:create`);
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      record('MySQL', 'FAIL', '账号或密码错误（请检查 .env 中的 DB_USERNAME / DB_PASSWORD）');
    } else {
      record('MySQL', 'FAIL', `${error.code ?? ''} ${error.message}`);
    }
  } finally {
    if (connection) await connection.end().catch(() => undefined);
  }
}

async function checkDeepseek() {
  const configured = checkPresence('DEEPSEEK_API_KEY');
  if (!configured) return;
  if (!LIVE) {
    record('DeepSeek', 'PENDING', '密钥已填写，加 --live 发起真实请求验证');
    return;
  }

  const baseUrl = (value('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = value('DEEPSEEK_MODEL') || 'deepseek-flash';
  const headers = { Authorization: `Bearer ${value('DEEPSEEK_API_KEY')}` };

  try {
    const models = await axios.get(`${baseUrl}/models`, { headers, timeout: 15000 });
    const ids = Array.isArray(models.data?.data)
      ? models.data.data.map((item) => item.id)
      : [];
    if (ids.includes(model)) {
      record('DeepSeek', 'OK', `密钥有效，模型 ${model} 可用`);
    } else {
      record(
        'DeepSeek',
        'WARN',
        `密钥有效，但未在模型列表中看到 ${model}；可用模型：${ids.slice(0, 8).join(', ') || '未返回'}`,
      );
    }
    return;
  } catch (error) {
    if (error.response?.status === 401) {
      record('DeepSeek', 'FAIL', 'API Key 无效（HTTP 401）');
      return;
    }
    if (error.response?.status !== 404) {
      record('DeepSeek', 'WARN', `/models 不可用（${error.response?.status ?? error.message}），尝试最小对话请求`);
    }
  }

  try {
    await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: '收到请回复 ok' }],
        max_tokens: 2,
        temperature: 0,
        stream: false,
      },
      { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 30000 },
    );
    record('DeepSeek', 'OK', `密钥有效，模型 ${model} 可完成最小对话请求`);
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.error?.message ?? error.message;
    record('DeepSeek', 'FAIL', `${status ? `HTTP ${status} · ` : ''}${String(message).slice(0, 200)}`);
  }
}

async function checkTaobao() {
  const appKeyOk = checkPresence('TAOBAO_APP_KEY');
  const secretOk = checkPresence('TAOBAO_APP_SECRET');
  const adzoneOk = checkPresence('TAOBAO_ADZONE_ID', '淘宝客物料搜索接口必需');
  const ok = appKeyOk && secretOk && adzoneOk;
  if (!ok) {
    record('淘宝 API', 'SKIP', '缺少配置，未发起请求');
    return;
  }
  if (!LIVE) {
    record('淘宝 API', 'PENDING', '配置已填写，加 --live 发起真实搜索请求');
    return;
  }

  const params = {
    method: 'taobao.tbk.dg.material.optional',
    app_key: value('TAOBAO_APP_KEY'),
    timestamp: formatTaobaoTimestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    q: '贴纸',
    adzone_id: value('TAOBAO_ADZONE_ID'),
    page_no: '1',
    page_size: '10',
  };
  params.sign = signTop(params, value('TAOBAO_APP_SECRET'));
  const gateway = value('TAOBAO_GATEWAY_URL') || 'https://eco.taobao.com/router/rest';

  try {
    const response = await axios.post(gateway, new URLSearchParams(params).toString(), {
      timeout: 20000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    });
    const data = response.data ?? {};
    if (data.error_response) {
      const err = data.error_response;
      record(
        '淘宝 API',
        'FAIL',
        [err.code, err.msg, err.sub_code, err.sub_msg].filter(Boolean).join(' / '),
      );
      return;
    }
    const body = data.tbk_dg_material_optional_response;
    if (!body) {
      record('淘宝 API', 'WARN', '请求成功但响应缺少 tbk_dg_material_optional_response 字段');
      return;
    }
    const list = body.result_list?.map_data;
    const count = Array.isArray(list) ? list.length : 0;
    record('淘宝 API', 'OK', `鉴权与签名通过，返回 ${count} 个候选（测试关键词：贴纸）`);
  } catch (error) {
    record(
      '淘宝 API',
      'FAIL',
      error.response?.status
        ? `HTTP ${error.response.status}`
        : String(error.message).slice(0, 200),
    );
  }
}

function unixSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

async function checkPinduoduo() {
  const clientIdOk = checkPresence('PDD_CLIENT_ID');
  const secretOk = checkPresence('PDD_CLIENT_SECRET');
  const ok = clientIdOk && secretOk;
  if (!ok) {
    record('拼多多 API', 'SKIP', '缺少配置，未发起请求');
    return;
  }
  if (!LIVE) {
    record('拼多多 API', 'PENDING', '配置已填写，加 --live 发起真实搜索请求');
    return;
  }

  const params = {
    type: 'pdd.ddk.goods.search',
    client_id: value('PDD_CLIENT_ID'),
    timestamp: unixSeconds(),
    data_type: 'JSON',
    keyword: '贴纸',
    page: '1',
    page_size: '10',
  };
  if (value('PDD_ACCESS_TOKEN')) params.access_token = value('PDD_ACCESS_TOKEN');
  params.sign = signTop(params, value('PDD_CLIENT_SECRET'));
  const gateway = value('PDD_GATEWAY_URL') || 'https://gw-api.pinduoduo.com/api/router';

  try {
    const response = await axios.post(gateway, new URLSearchParams(params).toString(), {
      timeout: 20000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    });
    const data = response.data ?? {};
    if (data.error_response) {
      const err = data.error_response;
      record(
        '拼多多 API',
        'FAIL',
        [err.error_code, err.error_msg, err.sub_code, err.sub_msg].filter(Boolean).join(' / '),
      );
      return;
    }
    const body = data.goods_search_response;
    if (!body) {
      record('拼多多 API', 'WARN', '请求成功但响应缺少 goods_search_response 字段');
      return;
    }
    const list = body.goods_list;
    const count = Array.isArray(list) ? list.length : 0;
    record('拼多多 API', 'OK', `鉴权与签名通过，返回 ${count} 个候选（测试关键词：贴纸）`);
  } catch (error) {
    record(
      '拼多多 API',
      'FAIL',
      error.response?.status
        ? `HTTP ${error.response.status}`
        : String(error.message).slice(0, 200),
    );
  }
}

function checkPlaywright() {
  try {
    const executable = chromium.executablePath();
    if (!executable || !fs.existsSync(executable)) {
      record('Playwright', 'FAIL', 'Chromium 未安装，请运行 npm run playwright:install');
      return;
    }
    record('Playwright', 'OK', 'Chromium 已安装');
  } catch (error) {
    record('Playwright', 'FAIL', String(error.message).slice(0, 200));
    return;
  }

  const root = path.resolve(process.cwd(), value('BROWSER_USER_DATA_DIR') || '.auth');
  for (const platform of ['douyin', 'xiaohongshu']) {
    const dir = path.join(root, platform);
    const exists = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    record(
      `Playwright 登录态 · ${platform}`,
      exists ? 'PROFILE_FOUND' : 'NOT_LOGGED_IN',
      exists
        ? '本地浏览器资料存在；登录是否仍有效需实际搜索确认'
        : `未发现登录资料，请运行 npm run browser:login -- ${platform}`,
    );
  }
}

async function main() {
  console.log('');
  console.log('StickerFinder 配置自检');
  console.log(`模式：${LIVE ? 'LIVE（会发起真实平台/AI 请求）' : 'PRESENCE（只检查配置与本地环境）'}`);
  console.log('说明：本脚本不会打印任何密钥、密码或 Cookie。');
  console.log('─'.repeat(72));

  checkOptional('AI_CLASSIFY_ENABLED', '未设置，默认启用');
  checkOptional('AI_VISION_ENABLED', '未设置，默认关闭');
  checkOptional('DEEPSEEK_MODEL', '未设置，默认 deepseek-flash');
  checkOptional('PLAYWRIGHT_HEADLESS', '未设置，默认可见浏览器');

  await checkDatabase();
  await checkDeepseek();
  await checkTaobao();
  await checkPinduoduo();
  checkPlaywright();

  console.log('─'.repeat(72));
  const failures = results.filter((item) => item.status === 'FAIL').length;
  const warnings = results.filter((item) => item.status === 'WARN').length;
  console.log(
    `完成：${results.length} 项检查，${failures} 项失败，${warnings} 项警告。` +
      (LIVE ? '' : ' 需要真实请求时请追加 --live。'),
  );
  if (failures > 0) {
    console.log('请根据上面的失败项检查 .env 或平台应用权限。');
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('配置自检执行失败：', error.message);
  process.exitCode = 1;
});
