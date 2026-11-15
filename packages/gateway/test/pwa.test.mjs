// PWA 静态检查：manifest 字段、SW push 处理、页面入口与设计 Token。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const WEB = path.join(REPO, 'apps', 'web');

test('PWA 文件齐全', () => {
  for (const file of ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(WEB, file)), '缺少 ' + file);
  }
});

test('manifest 符合 PWA 安装要求', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.lang, 'zh-CN');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('Service Worker 包含 push / notificationclick / 缓存', () => {
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /caches\.open/);
  assert.match(sw, /dsh-watch/);
});

test('页面与脚本使用设计 Token 与五个页面路由', () => {
  const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
  assert.match(css, /--green: #16735C/);
  assert.match(css, /--amber: #955B12/);
  assert.match(css, /--paper: #F3F5F1/);
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  for (const route of ['pair', 'tasks', 'task', 'reminders', 'settings']) assert.match(app, new RegExp("'" + route + "'"));
  assert.match(app, /applicationServerKey/);
  assert.match(app, /pushManager\.subscribe/);
});
