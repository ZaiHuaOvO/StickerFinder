/* eslint-disable no-console */
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../.env')],
});

const mysql = require('mysql2/promise');

async function main() {
  const dbType = (process.env.DB_TYPE ?? 'mysql').toLowerCase();
  if (dbType === 'sqlite') {
    console.log('DB_TYPE=sqlite，无需创建 MySQL 数据库。');
    return;
  }

  const database = process.env.DB_DATABASE ?? 'sticker_finder';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`数据库名不合法：${database}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`数据库 ${database} 已就绪（utf8mb4）。`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('创建数据库失败：', error.message);
  console.error('请确认 .env 中的 DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD 正确。');
  process.exitCode = 1;
});
