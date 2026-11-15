// 测试公共工具。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(TEST_DIR, '../../..');
export const FIXTURES_DIR = path.join(REPO, 'fixtures');

export function listFixtures() {
  const found = [];
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(rel);
    }
  }
  walk(FIXTURES_DIR, '');
  return found.sort();
}

export function loadFixture(name) {
  const records = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const header = records[0];
  const events = records.slice(1);
  return { header, events };
}

/** 构造 DSH 事件（fixtures/真实日志同构）。 */
export function dsh(seq, time, type, data = {}) {
  return { seq, time, type, data };
}

export function makeHeader(overrides = {}) {
  return {
    version: 4,
    id: 'session-test-0001',
    createdAt: 1790000000000,
    cwd: 'C:\\demo\\workspace',
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
    ...overrides,
  };
}

export function makeSession(headerOverrides = {}, events = []) {
  const header = makeHeader(headerOverrides);
  return {
    header,
    snapshotEvents() { return events; },
  };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function waitFor(check, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor timeout' + (lastError ? ': ' + lastError.message : ''));
}

export async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  return { status: response.status, body: await response.json() };
}
