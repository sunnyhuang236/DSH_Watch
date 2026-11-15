// 调试面板：读取同目录 panel.html 并注入版本占位符（零构建）。
import fs from 'node:fs';

const PANEL_URL = new URL('./panel.html', import.meta.url);
let cached = null;

export function renderPanel({ version = '0.1.0', contract = 'm1-v0.1' } = {}) {
  if (cached === null) cached = fs.readFileSync(PANEL_URL, 'utf8');
  return cached.replaceAll('__VERSION__', version).replaceAll('__CONTRACT__', contract);
}
