// DSH Watch PWA（M2）：配对、任务列表、详情、提醒记录、设置。
// 纯原生 ES module，无构建步骤；数据来自同源网关 /v1（设备 Bearer token）。
const view = document.getElementById('view');
const connectionEl = document.getElementById('connection');
const refreshBtn = document.getElementById('refreshBtn');
const badgeEl = document.getElementById('badge');
const toastEl = document.getElementById('toast');

const TOKEN_KEY = 'dsh_watch_token';
const DEVICE_KEY = 'dsh_watch_device';
const DEFAULT_SETTINGS = { notify: { succeeded: true, failed: true, waiting: true }, hideContent: true };

const STATE_META = {
  running: { label: '运行中', symbol: '●', cls: 'running' },
  waiting_input: { label: '等待你输入', symbol: '◷', cls: 'waiting_input' },
  waiting_approval: { label: '等待审批', symbol: '◷', cls: 'waiting_approval' },
  succeeded: { label: '已完成', symbol: '✓', cls: 'succeeded' },
  failed: { label: '执行失败', symbol: '×', cls: 'failed' },
  cancelled: { label: '已取消', symbol: '—', cls: 'cancelled' },
  unknown: { label: '状态未知', symbol: '?', cls: 'unknown' },
};

const EVENT_LABELS = {
  run_started: '轮次开始', run_finished: '轮次结束', step_started: '步骤开始', step_finished: '步骤结束',
  tool_started: '工具调用', tool_finished: '工具结果', assistant: '模型输出', user_message: '用户消息',
  approval_requested: '审批请求', approval_decided: '审批结果', job_started: '后台任务开始', job_finished: '后台任务结束',
  title: '标题', subagent: '子代理', team: '团队', goal: '目标', diagnostic: '诊断', unknown: '未知事件',
};

const appState = {
  tasks: [],
  settings: { ...DEFAULT_SETTINGS },
  device: null,
  connection: 'unknown',
  lastSync: null,
  publicUrl: null,
  watcher: null,
  route: { name: 'tasks', params: {} },
};

// ---------------- 基础工具 ----------------
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function fmtTime(t) { if (!t) return '暂无'; const d = new Date(t); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fmtClock(t) { if (!t) return '—'; return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function relTime(t) {
  if (!t) return '暂无';
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  return Math.floor(diff / 86400000) + ' 天前';
}
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function saveDevice(device, token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (device) localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  appState.device = device || appState.device;
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DEVICE_KEY);
  appState.tasks = [];
  appState.device = null;
}

// ---------------- IndexedDB ----------------
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('dsh-watch', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'task_id' });
      if (!db.objectStoreNames.contains('reminders')) db.createObjectStore('reminders', { keyPath: 'record_id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
async function idbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
async function pruneLocalData(days = 30) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const reminders = await listReminders();
  for (const item of reminders) if ((item.created_at || 0) < cutoff) await idbDelete('reminders', item.record_id);
  const tasks = await idbGetAll('tasks');
  for (const task of tasks) {
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(task.state);
    if (terminal && (task.updated_at || 0) < cutoff) await idbDelete('tasks', task.task_id);
  }
}
async function loadSettings() {
  const stored = await idbGet('meta', 'settings');
  appState.settings = stored && stored.value ? { ...DEFAULT_SETTINGS, ...stored.value, notify: { ...DEFAULT_SETTINGS.notify, ...(stored.value.notify || {}) } } : { ...DEFAULT_SETTINGS };
  return appState.settings;
}
async function saveSettings(next) {
  appState.settings = next;
  await idbPut('meta', { key: 'settings', value: next });
}
async function cacheTasks(tasks) {
  for (const task of tasks) await idbPut('tasks', task);
}
async function getCachedTasks() {
  const tasks = await idbGetAll('tasks');
  return tasks.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}
async function listReminders() {
  const items = await idbGetAll('reminders');
  return items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

// ---------------- API ----------------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  if (response.status === 401) {
    clearSession();
    location.hash = '#/pair';
    throw new Error('unauthorized');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body.error && body.error.message) || ('HTTP ' + response.status));
  return body;
}

async function refreshTasks({ quiet = false } = {}) {
  try {
    try {
      const health = await fetch('/v1/health', { cache: 'no-store' }).then((response) => response.json());
      appState.publicUrl = health.public_url || null;
      appState.watcher = health.watcher || null;
    } catch { /* health 失败不影响任务请求 */ }
    const body = await api('/v1/tasks?limit=200');
    appState.tasks = Array.isArray(body.tasks) ? body.tasks : [];
    appState.connection = 'online';
    appState.lastSync = Date.now();
    await cacheTasks(appState.tasks);
    renderConnection();
    if (appState.route.name === 'tasks') renderTasks(false);
    return appState.tasks;
  } catch (error) {
    appState.connection = navigator.onLine ? 'error' : 'offline';
    renderConnection();
    if (!quiet) {
      const cached = await getCachedTasks();
      appState.tasks = cached;
      if (!cached.length) toast('无法连接电脑，且没有缓存');
    }
    return appState.tasks;
  }
}

function renderConnection() {
  connectionEl.classList.remove('hidden', 'online');
  if (appState.publicUrl && location.origin !== appState.publicUrl) {
    connectionEl.textContent = '访问地址已变化：请用电脑上最新隧道地址重新打开并配对（' + appState.publicUrl + '）';
    return;
  }
  if (appState.connection === 'online') {
    connectionEl.classList.add('online');
    connectionEl.textContent = '电脑在线 · 更新于 ' + fmtClock(appState.lastSync);
    if (Date.now() - (appState.lastSync || 0) < 15000) connectionEl.classList.add('hidden');
  } else if (appState.connection === 'offline') {
    connectionEl.textContent = '网络断开 · 正在显示 ' + fmtClock(appState.lastSync) + ' 同步的状态';
  } else {
    connectionEl.textContent = '电脑连接中断 · 正在显示 ' + fmtClock(appState.lastSync) + ' 同步的状态';
  }
}

// ---------------- 路由 ----------------
function parseRoute() {
  const raw = (location.hash || '#/tasks').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  if (!parts.length) return { name: 'tasks', params: query };
  if (parts[0] === 'pair') return { name: 'pair', params: query };
  if (parts[0] === 'tasks') return { name: 'tasks', params: query };
  if (parts[0] === 'task' && parts[1]) return { name: 'task', params: { ...query, taskId: decodeURIComponent(parts[1]) } };
  if (parts[0] === 'reminders') return { name: 'reminders', params: query };
  if (parts[0] === 'settings') return { name: 'settings', params: query };
  return { name: 'tasks', params: query };
}

async function render() {
  const route = parseRoute();
  appState.route = route;
  await loadSettings();
  updateTabs(route);
  updateBadge();
  if (!getToken() && route.name !== 'pair') { location.hash = '#/pair'; return; }
  if (route.name === 'pair') return renderPair(route.params);
  if (route.name === 'tasks') return renderTasks(true);
  if (route.name === 'task') return renderTask(route.params);
  if (route.name === 'reminders') return renderReminders();
  if (route.name === 'settings') return renderSettings();
}

function updateTabs(route) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const name = tab.dataset.tab;
    const active = (route.name === 'tasks' && name === 'tasks') || (route.name === 'reminders' && name === 'reminders') || (route.name === 'settings' && name === 'settings') || (route.name === 'task' && name === 'tasks');
    tab.classList.toggle('active', active);
  });
  document.getElementById('tabs').classList.toggle('hidden', route.name === 'pair');
  document.querySelector('.topbar').classList.toggle('hidden', route.name === 'pair');
}

async function updateBadge() {
  const reminders = await listReminders();
  const unread = reminders.filter((item) => !item.read_at).length;
  badgeEl.textContent = unread > 99 ? '99+' : String(unread);
  badgeEl.classList.toggle('hidden', unread === 0);
}

// ---------------- 配对 ----------------
function renderPair(params = {}) {
  const search = new URLSearchParams(location.search || '');
  const prefill = params.code || search.get('code') || '';
  view.innerHTML = `
    <div class="pair-wrap">
      <div class="pair-hero">
        <h1>连接你的电脑</h1>
        <p>在电脑上运行 <code>npm run pair</code>，输入它显示的 8 位配对码。</p>
      </div>
      <form id="pairForm" class="pair-card card">
        <label class="field"><span>8 位配对码</span>
          <input id="pairCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="00000000" value="${esc(prefill)}">
        </label>
        <label class="field"><span>设备名称</span>
          <input id="pairName" maxlength="40" placeholder="我的 iPhone">
        </label>
        <div id="pairError" class="error-text"></div>
        <button class="btn primary block" type="submit" id="pairSubmit">连接电脑</button>
      </form>
      <p class="pair-note">配对只在电脑与手机之间进行；配对成功后设备凭证只保存在本机。<br>电脑上会显示设备名称，确认后才能完成连接。</p>
    </div>`;
  const nameInput = document.getElementById('pairName');
  nameInput.value = localStorage.getItem('dsh_watch_device_name') || guessDeviceName();
  if (prefill) document.getElementById('pairCode').value = prefill;
  document.getElementById('pairForm').addEventListener('submit', onSubmitPair);
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return '我的设备';
}

async function onSubmitPair(event) {
  event.preventDefault();
  const code = document.getElementById('pairCode').value.replace(/\s+/g, '');
  const deviceName = document.getElementById('pairName').value.trim() || guessDeviceName();
  const errorEl = document.getElementById('pairError');
  errorEl.textContent = '';
  if (!/^\d{8}$/.test(code)) { errorEl.textContent = '请输入 8 位数字配对码。'; return; }
  localStorage.setItem('dsh_watch_device_name', deviceName);
  try {
    const response = await fetch('/v1/pair/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_name: deviceName }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error((body.error && body.error.message) || '配对失败');
    showWaiting(body);
  } catch (error) {
    errorEl.textContent = error.message === 'pairing_not_found' ? '配对码不存在或已过期。' : error.message;
  }
}

function showWaiting(request) {
  view.innerHTML = `
    <div class="pair-wrap">
      <div class="waiting card">
        <div class="spinner"></div>
        <h2 style="margin:0 0 8px">等待电脑确认</h2>
        <p class="muted" style="margin:0">请在电脑上确认设备名称后完成配对。</p>
        <p class="muted small" style="margin-top:18px">配对码有效至 ${esc(fmtTime(request.expires_at))}</p>
        <button class="btn" type="button" id="cancelPair" style="margin-top:18px">取消</button>
      </div>
    </div>`;
  document.getElementById('cancelPair').addEventListener('click', () => { location.hash = '#/pair'; });
  pollPair(request);
}

async function pollPair(request) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    await sleep(1000);
    if (!document.getElementById('cancelPair')) return; // 页面已切走
    try {
      const response = await fetch('/v1/pair/requests/' + encodeURIComponent(request.request_id) + '?token=' + encodeURIComponent(request.poll_token));
      if (!response.ok) { toast('配对请求已失效'); location.hash = '#/pair'; return; }
      const body = await response.json();
      if (body.status === 'confirmed' && body.device_token) {
        saveDevice({ device_id: body.device_id, name: body.device_name }, body.device_token);
        toast('配对成功');
        history.replaceState(null, '', '/#/tasks');
        location.hash = '#/tasks';
        render();
        return;
      }
      if (body.status === 'rejected') { toast('电脑拒绝了这次配对'); location.hash = '#/pair'; return; }
      if (body.status === 'expired') { toast('配对码已过期，请重新生成'); location.hash = '#/pair'; return; }
    } catch { /* 继续轮询 */ }
  }
  toast('等待超时，请重新配对');
  location.hash = '#/pair';
}

// ---------------- 任务列表 ----------------
async function renderTasks(refresh = true) {
  const cached = await getCachedTasks();
  if (cached.length && !appState.tasks.length) appState.tasks = cached;
  if (!appState.tasks.length) appState.tasks = cached;
  drawTasks();
  if (refresh) await refreshTasks({ quiet: true });
}

function groupTasks(tasks) {
  const waiting = [];
  const running = [];
  const ended = [];
  for (const task of tasks) {
    if (task.state === 'waiting_input' || task.state === 'waiting_approval') waiting.push(task);
    else if (task.state === 'running' || task.state === 'unknown') running.push(task);
    else ended.push(task);
  }
  return { waiting, running, ended };
}

function drawTasks() {
  const { waiting, running, ended } = groupTasks(appState.tasks);
  const total = appState.tasks.length;
  const notifyBanner = notificationBanner();
  if (!total) {
    view.innerHTML = notifyBanner + emptyState('◫', appState.connection === 'error' ? '无法连接电脑' : '还没有任务', appState.connection === 'error' ? '检查电脑上的 DSH 与网关是否运行；已有缓存时会继续显示。' : '在电脑上运行 DSH 任务后，这里会出现任务状态。');
    bindNotifyBanner();
    return;
  }
  const row = (task) => taskRow(task);
  view.innerHTML = `
    ${notifyBanner}
    <h1 class="page-title">任务</h1>
    <p class="page-sub">${appState.lastSync ? '更新于 ' + fmtClock(appState.lastSync) : '等待同步'}</p>
    <div class="stats">
      <div class="stat"><b>${waiting.length}</b><span>待处理</span></div>
      <div class="stat"><b>${running.length}</b><span>运行中</span></div>
      <div class="stat"><b>${ended.length}</b><span>最近结束</span></div>
    </div>
    ${waiting.length ? '<div class="section-title">需要你处理 <span class="count">' + waiting.length + '</span></div>' + waiting.map(row).join('') : ''}
    ${running.length ? '<div class="section-title">运行中 <span class="count">' + running.length + '</span></div>' + running.map(row).join('') : ''}
    ${ended.length ? '<div class="section-title">最近结束 <span class="count">' + ended.length + '</span></div>' + ended.map(row).join('') : ''}`;
  bindNotifyBanner();
}

function notificationBanner() {
  if (!('Notification' in window)) return '';
  if (Notification.permission === 'granted') return '';
  if (Notification.permission === 'denied') {
    return '<div class="notify-banner denied"><div><b>通知已被拒绝</b><span>到 iOS 设置 → 通知 → DSH Watch 开启；提醒记录仍完整保留。</span></div></div>';
  }
  return '<div class="notify-banner"><div><b>开启通知</b><span>离开电脑也能收到完成 / 失败 / 等待提醒</span></div><button class="btn primary" id="enableNotifyBanner" type="button">开启</button></div>';
}

function bindNotifyBanner() {
  const button = document.getElementById('enableNotifyBanner');
  if (button) button.addEventListener('click', enableNotifications);
}

function taskRow(task) {
  const meta = STATE_META[task.state] || STATE_META.unknown;
  return `<a class="task card" href="#/task/${encodeURIComponent(task.task_id)}">
    <div class="task-row">
      <div class="task-title">${esc(task.title || task.task_id)}</div>
      <span class="chip ${meta.cls}">${meta.symbol} ${meta.label}</span>
    </div>
    <div class="task-summary">${esc(task.summary || '暂无摘要')}</div>
    <div class="task-meta"><span>${esc(relTime(task.updated_at))}</span><span>·</span><span>${esc(fmtTime(task.updated_at))}</span>${task.delegation_depth ? '<span>·</span><span>子代理</span>' : ''}</div>
  </a>`;
}

function emptyState(symbol, title, text) {
  return `<div class="empty"><span class="big">${symbol}</span><p><b>${esc(title)}</b></p><p class="small">${esc(text)}</p></div>`;
}

// ---------------- 任务详情 ----------------
async function renderTask(params) {
  const taskId = params.taskId;
  const cached = appState.tasks.find((item) => item.task_id === taskId) || (await idbGet('tasks', taskId));
  let task = cached;
  let events = [];
  let actions = [];
  let questions = [];
  try {
    task = await api('/v1/tasks/' + encodeURIComponent(taskId));
    const eventPage = await api('/v1/tasks/' + encodeURIComponent(taskId) + '/events?after_seq=-1&limit=120');
    events = eventPage.events || [];
    try { const actionPage = await api('/v1/actions?task_id=' + encodeURIComponent(taskId)); actions = actionPage.actions || []; } catch { /* M4 未启用时忽略 */ }
    try { const questionPage = await api('/v1/questions?task_id=' + encodeURIComponent(taskId)); questions = questionPage.questions || []; } catch { /* M4-B 未启用时忽略 */ }
    await idbPut('tasks', task);
  } catch (error) {
    if (!task) { view.innerHTML = emptyState('⚠', '无法加载任务', '连接电脑后重试。'); return; }
  }
  const meta = STATE_META[task.state] || STATE_META.unknown;
  const highlight = params.from === 'reminder'
    ? (isWaitingKind(params.kind) && !isWaitingKind(task.state)
      ? '<div class="highlight handled">该事项已在电脑处理。</div>'
      : '<div class="highlight">由提醒进入 · 触发原因：' + esc(kindLabel(params.kind)) + '</div>')
    : '';
  const waiting = task.waiting
    ? `<div class="wait-banner"><b>需要在电脑处理</b>${esc(waitingText(task))}</div>`
    : '';
  const approval = approvalCard(actions);
  const question = questionCard(questions);
  const ended = ['succeeded', 'failed', 'cancelled'].includes(task.state);
  view.innerHTML = `
    ${highlight}
    <div class="detail-head"><h1>${esc(task.title || task.task_id)}</h1><span class="chip ${meta.cls}">${meta.symbol} ${meta.label}</span></div>
    <p class="meta-line">数据更新于 ${esc(fmtTime(task.updated_at))}</p>
    ${waiting}
    ${approval}
    ${question}
    <section class="panel card">
      <h2>当前步骤</h2>
      <p>${task.current_step != null ? '步骤 ' + task.current_step : '暂无步骤信息'}${task.current_tool ? ' · ' + esc(task.current_tool) : ''}</p>
    </section>
    <section class="panel card">
      <h2>${ended ? (task.state === 'failed' ? '失败摘要' : '结果摘要') : '摘要'}</h2>
      <p>${esc(task.summary || '暂无数据')}</p>
    </section>
    <section class="panel card">
      <h2>时间与来源</h2>
      <dl class="kv">
        <dt>开始</dt><dd>${esc(fmtTime(task.started_at))}</dd>
        <dt>最近活动</dt><dd>${esc(fmtTime(task.last_activity_at))}</dd>
        <dt>结束</dt><dd>${esc(fmtTime(task.ended_at))}</dd>
        <dt>执行</dt><dd>${esc(task.run_id || '暂无')}</dd>
        <dt>子代理</dt><dd>${task.agent_count ? task.agent_count + ' 个' : '无'}${task.delegation_depth ? ' · 深度 ' + task.delegation_depth : ''}</dd>
        <dt>父任务</dt><dd>${task.parent_task_id ? esc(task.parent_task_id) : '无'}</dd>
        <dt>来源</dt><dd>${esc(task.origin || '暂无')}</dd>
        <dt>代理状态</dt><dd>${esc(task.agent_state || '未知')}</dd>
        <dt>费用</dt><dd>${task.cost == null ? '暂无数据' : esc(String(task.cost))}</dd>
        <dt>用量</dt><dd>${task.token_usage ? (task.token_usage.input_tokens + task.token_usage.output_tokens) + ' tokens' : '暂无数据'}</dd>
      </dl>
    </section>
    ${trajectorySection(events)}`;
  bindApprovalActions(taskId);
  bindQuestionActions(taskId);
  updateTabs({ name: 'task' });
}

function approvalCard(actions) {
  const pending = (actions || []).filter((item) => item.status === 'pending');
  if (!pending.length) {
    const resolved = (actions || []).find((item) => item.status === 'decided' || item.status === 'resolved');
    return resolved ? `<div class="approval-card resolved"><b>审批已处理</b><span>${resolved.decision === 'mobile' ? '已在手机提交' : '已在电脑处理'}</span></div>` : '';
  }
  return pending.map((item) => `<div class="approval-card" data-action="${esc(item.action_id)}">
    <div class="approval-head"><b>需要你的决定</b><span class="chip waiting_approval">等待审批</span></div>
    <p>${esc(item.display_reason && item.display_reason.zh ? item.display_reason.zh : (item.reason || ('工具 ' + item.tool_name + ' 请求执行')))}</p>
    <div class="approval-actions">
      <button class="btn danger" data-decision="rejected" type="button">拒绝</button>
      <button class="btn primary" data-decision="allowed-once" type="button">允许一次</button>
    </div>
  </div>`).join('');
}

function bindApprovalActions(taskId) {
  document.querySelectorAll('.approval-card[data-action]').forEach((card) => {
    const actionId = card.dataset.action;
    card.querySelectorAll('button[data-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        const decision = button.dataset.decision;
        card.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        try {
          const result = await api('/v1/actions/' + encodeURIComponent(actionId) + '/decision', {
            method: 'POST', body: JSON.stringify({ decision }),
          });
          toast(result.status === 'accepted' ? '已提交，等待电脑确认' : '该审批已被处理');
          await renderTask({ taskId });
        } catch (error) {
          toast('审批提交失败：' + (error.message || '请重试'));
          card.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      });
    });
  });
}

function questionCard(questions) {
  const pending = (questions || []).filter((item) => item.status === 'pending');
  if (!pending.length) {
    const resolved = (questions || []).find((item) => item.status === 'answered' || item.status === 'resolved');
    return resolved ? `<div class="question-card resolved"><b>问答已处理</b><span>${resolved.decision === 'mobile' ? '已在手机提交' : '已在电脑回答'}</span></div>` : '';
  }
  return pending.map((item) => `<div class="question-card" data-qaction="${esc(item.action_id)}">
    <div class="approval-head"><b>需要你回答</b><span class="chip waiting_input">等待答题</span></div>
    ${item.questions.map((question) => `<div class="question-item" data-question="${esc(question.id)}">
      <p>${esc(question.question)}</p>
      ${question.detail ? `<small>${esc(question.detail)}</small>` : ''}
      ${question.options && question.options.length ? `<div class="question-options">${question.options.map((option) => `<label><input type="${question.multi_select ? 'checkbox' : 'radio'}" name="q_${esc(item.action_id)}_${esc(question.id)}" data-option="${esc(option.label)}"> ${esc(option.label)}${option.description ? ` <small>${esc(option.description)}</small>` : ''}</label>`).join('')}</div>` : ''}
      <input class="question-custom" placeholder="补充回答（可选）">
    </div>`).join('')}
    <button class="btn primary" data-answer type="button">提交回答</button>
  </div>`).join('');
}

function bindQuestionActions(taskId) {
  document.querySelectorAll('.question-card[data-qaction]').forEach((card) => {
    const actionId = card.dataset.qaction;
    card.querySelector('[data-answer]').addEventListener('click', async () => {
      const answers = [];
      card.querySelectorAll('.question-item').forEach((item) => {
        const selected = [...item.querySelectorAll('input[data-option]:checked')].map((input) => input.dataset.option);
        const custom = item.querySelector('.question-custom').value.trim();
        const answer = { id: item.dataset.question, selected };
        if (custom) answer.custom = custom;
        answers.push(answer);
      });
      card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      try {
        const result = await api('/v1/questions/' + encodeURIComponent(actionId) + '/answer', {
          method: 'POST', body: JSON.stringify({ answers }),
        });
        toast(result.status === 'accepted' ? '回答已提交，等待电脑确认' : '该问题已处理');
        await renderTask({ taskId });
      } catch (error) {
        toast('回答提交失败：' + (error.message || '请重试'));
        card.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      }
    });
  });
}

function trajectorySection(events) {
  if (!events || !events.length) return '<section class="panel card"><h2>轨迹</h2><p class="muted small">暂无事件</p></section>';
  const groups = new Map();
  for (const event of events) {
    const turn = event.payload && event.payload.turn;
    const key = event.run_id || (turn != null ? 'turn:' + turn : 'other');
    if (!groups.has(key)) groups.set(key, { key, turn, events: [] });
    groups.get(key).events.push(event);
  }
  const list = [...groups.values()].sort((a, b) => {
    const lastA = a.events[a.events.length - 1];
    const lastB = b.events[b.events.length - 1];
    return (lastA.seq || 0) - (lastB.seq || 0);
  });
  const rows = list.map((group, index) => {
    const abnormal = group.events.some((event) => {
      const p = event.payload || {};
      return p.is_error === true || event.type === 'diagnostic' || event.type === 'approval_decided'
        || p.reason_kind === 'error' || p.reason_kind === 'blocked' || p.reason_kind === 'max-tokens'
        || p.outcome === 'rejected' || p.outcome === 'cancelled';
    });
    const open = index === list.length - 1 || abnormal;
    const label = group.turn != null ? '轮次 ' + group.turn : (group.key === 'other' ? '其他事件' : '轮次');
    const body = group.events.slice().reverse().map((event) => {
      const p = event.payload || {};
      const extra = p.name ? ' · ' + esc(p.name) : p.tool_name ? ' · ' + esc(p.tool_name) : p.reason_kind ? ' · ' + esc(p.reason_kind) : '';
      return `<div class="event"><div><span class="etype">${esc(EVENT_LABELS[event.type] || event.type)}${extra}</span> <span class="etime">${esc(fmtClock(event.occurred_at))} · #${event.seq}</span></div></div>`;
    }).join('');
    return `<details class="trajectory-run" ${open ? 'open' : ''}><summary><b>${esc(label)}</b> <span>${group.events.length} 条事件${abnormal ? ' · <em>含异常</em>' : ''}</span></summary>${body}</details>`;
  }).join('');
  return `<section class="panel card"><h2>轨迹（按轮次折叠）</h2>${rows}</section>`;
}

function isWaitingKind(kind) { return kind === 'waiting_input' || kind === 'waiting_approval'; }function kindLabel(kind) { return ({ waiting_input: '等待你输入', waiting_approval: '等待审批', succeeded: '任务完成', failed: '任务失败', cancelled: '任务取消' })[kind] || '状态变化'; }
function waitingText(task) {
  const waiting = task.waiting || {};
  if (waiting.kind === 'approval') return '等待你在电脑上批准' + (waiting.tool_name ? '「' + waiting.tool_name + '」' : '') + '；请在电脑继续。';
  return '等待你确认' + (waiting.tool_name ? '（' + waiting.tool_name + '）' : '') + '；请在电脑继续。';
}

// ---------------- 提醒记录 ----------------
async function renderReminders() {
  const reminders = await listReminders();
  const unread = reminders.filter((item) => !item.read_at).length;
  if (!reminders.length) {
    view.innerHTML = `<h1 class="page-title">提醒</h1><p class="page-sub">提醒保存在本机；添加到主屏幕后可收到锁屏提醒。</p>` + emptyState('◔', '还没有提醒', '任务完成或需要你处理时会出现在这里。') + '<div style="text-align:center"><a class="btn" href="#/tasks">去看任务</a></div>';
    return;
  }
  view.innerHTML = `
    <h1 class="page-title">提醒</h1>
    <p class="page-sub">提醒保存在本机；系统通知被关闭或静音时也能回看。</p>
    <div class="tool-row"><span>${unread} 条未读 · 共 ${reminders.length} 条</span><button class="link-btn" id="markAll">全部已读</button></div>
    ${reminders.map((item) => `
      <div class="reminder card ${item.read_at ? '' : 'unread'}" data-record="${esc(item.record_id)}" data-task="${esc(item.task_id)}" data-kind="${esc(item.kind)}">
        <div class="reminder-row"><span class="reminder-title">${esc(item.title || '任务提醒')}</span><span class="chip ${kindChip(item.kind)}">${esc(kindLabel(item.kind))}</span></div>
        <div class="reminder-summary">${esc(item.summary || '打开查看详情')}</div>
        <div class="reminder-meta">${item.read_at ? '' : '<span class="dot"></span><span>未读</span>'}<span>${esc(relTime(item.created_at))}</span><span>·</span><span>${esc(fmtTime(item.created_at))}</span></div>
      </div>`).join('')}`;
  document.getElementById('markAll').addEventListener('click', async () => {
    for (const item of reminders) if (!item.read_at) await idbPut('reminders', { ...item, read_at: Date.now() });
    await updateBadge(); renderReminders();
  });
  document.querySelectorAll('.reminder').forEach((node) => node.addEventListener('click', async () => {
    const recordId = node.dataset.record;
    const item = reminders.find((entry) => entry.record_id === recordId);
    if (item && !item.read_at) await idbPut('reminders', { ...item, read_at: Date.now() });
    await updateBadge();
    location.hash = '#/task/' + encodeURIComponent(node.dataset.task) + '?from=reminder&kind=' + encodeURIComponent(node.dataset.kind);
  }));
}

function kindChip(kind) {
  if (kind === 'waiting_input' || kind === 'waiting_approval') return 'waiting_input';
  if (kind === 'failed') return 'failed';
  if (kind === 'succeeded') return 'succeeded';
  return 'unknown';
}

// ---------------- 设置 ----------------
async function renderSettings() {
  let device = appState.device;
  try { device = await api('/v1/devices/current'); appState.device = device; } catch { /* 使用缓存 */ }
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const settings = appState.settings;
  view.innerHTML = `
    <h1 class="page-title">设置</h1>
    <p class="page-sub">提醒仅在本机生效；锁屏推送通过 PWA 提供。</p>

    <div class="settings-group"><h2>提醒</h2><div class="card">
      ${toggleRow('notify-succeeded', '完成提醒', '任务成功完成时提醒', settings.notify.succeeded)}
      ${toggleRow('notify-failed', '失败提醒', '任务失败或取消时提醒', settings.notify.failed)}
      ${toggleRow('notify-waiting', '待处理提醒', '等待输入或审批时提醒', settings.notify.waiting)}
    </div></div>

    <div class="settings-group"><h2>PWA 与通知</h2><div class="card">
      <div class="setting-row"><div class="label"><b>安装状态</b><small>${standalone ? '已添加到主屏幕' : '未安装 · 点 Safari 分享 → 添加到主屏幕'}</small></div><span class="value-text">${standalone ? '已安装' : '未安装'}</span></div>
      <div class="setting-row"><div class="label"><b>通知权限</b><small>${permissionText(permission)}</small></div><button class="btn" id="enableNotify" ${permission === 'granted' || permission === 'unsupported' ? 'disabled' : ''}>${permission === 'granted' ? '已开启' : '开启通知'}</button></div>
      <div class="setting-row"><div class="label"><b>安装引导</b><small>Safari 分享 → 添加到主屏幕 → 允许通知</small></div><span class="value-text">iOS 16.4+</span></div>
    </div></div>

    <div class="settings-group"><h2>隐私</h2><div class="card">
      ${toggleRow('hide-content', '锁屏隐藏任务内容', '通知只显示通用文案', settings.hideContent)}
    </div></div>

    <div class="settings-group"><h2>设备</h2><div class="card">
      <div class="setting-row"><div class="label"><b>访问地址</b><small>${appState.publicUrl && location.origin !== appState.publicUrl ? '地址已变化，请重新打开/配对' : '当前 PWA 地址'}</small></div><span class="value-text">${esc(appState.publicUrl || location.origin)}</span></div>
      <div class="setting-row"><div class="label"><b>当前电脑</b><small>${esc((device && device.name) || '未配对')}</small></div><span class="value-text">${esc((device && device.device_id) || '—')}</span></div>
      <div class="setting-row"><div class="label"><b>配对时间</b><small>${esc(fmtTime(device && device.created_at))}</small></div></div>
      <div class="setting-row"><div class="label"><b>本地缓存</b><small>任务缓存与提醒记录仅保存在本机</small></div><button class="btn" id="clearCache">清除缓存</button></div>
      <div class="setting-row"><div class="label"><b>解除配对</b><small>撤销本机凭证并清除本地缓存</small></div><button class="btn danger" id="unpair">解除</button></div>
    </div></div>

    <p class="version">DSH Watch · M2 · 0.1.0</p>`;

  for (const key of ['notify-succeeded', 'notify-failed', 'notify-waiting', 'hide-content']) {
    const input = document.getElementById(key);
    input.addEventListener('change', async () => {
      const next = { ...appState.settings, notify: { ...appState.settings.notify } };
      if (key === 'notify-succeeded') next.notify.succeeded = input.checked;
      if (key === 'notify-failed') next.notify.failed = input.checked;
      if (key === 'notify-waiting') next.notify.waiting = input.checked;
      if (key === 'hide-content') next.hideContent = input.checked;
      await saveSettings(next);
      toast('已保存');
    });
  }
  const enableBtn = document.getElementById('enableNotify');
  if (enableBtn) enableBtn.addEventListener('click', enableNotifications);
  const clearBtn = document.getElementById('clearCache');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('清除本机任务缓存与提醒记录？')) return;
    await idbClear('tasks');
    await idbClear('reminders');
    appState.tasks = [];
    await updateBadge();
    toast('已清除本机缓存');
    renderSettings();
  });
  document.getElementById('unpair').addEventListener('click', unpair);
}

function toggleRow(id, label, hint, checked) {
  return `<div class="setting-row"><div class="label"><b>${esc(label)}</b><small>${esc(hint)}</small></div><label class="switch"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span></label></div>`;
}
function permissionText(permission) {
  if (permission === 'granted') return '已允许';
  if (permission === 'denied') return '已被拒绝 · 到 iOS 设置中开启';
  if (permission === 'unsupported') return '当前浏览器不支持通知';
  return '未询问';
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('当前浏览器不支持通知'); return; }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { toast('通知未允许 · 提醒记录仍完整保留'); renderSettings(); return; }
  try {
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await fetch('/v1/push/public-key');
    const { public_key } = await keyResponse.json();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) });
    }
    await api('/v1/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
    toast('已开启通知');
  } catch (error) {
    toast('开启通知失败：' + error.message);
  }
  renderSettings();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

async function unpair() {
  if (!confirm('解除配对会撤销本机凭证并清除缓存，确定？')) return;
  try { await api('/v1/devices/current', { method: 'DELETE' }); } catch { /* 离线也允许本地解除 */ }
  clearSession();
  await idbClear('tasks');
  await idbClear('reminders');
  toast('已解除配对');
  location.hash = '#/pair';
}

// ---------------- 启动 ----------------
async function start() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch { /* 忽略 */ }
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { appState.connection = 'unknown'; refreshTasks({ quiet: true }); });
  window.addEventListener('offline', () => { appState.connection = 'offline'; renderConnection(); });
  refreshBtn.addEventListener('click', async () => {
    if (appState.route.name === 'tasks') { await refreshTasks(); toast('已刷新'); }
    else if (appState.route.name === 'task') renderTask(appState.route.params);
    else if (appState.route.name === 'reminders') renderReminders();
    else if (appState.route.name === 'settings') renderSettings();
  });
  document.getElementById('tabs').addEventListener('click', () => { /* hashchange 处理 */ });
  await loadSettings();
  await pruneLocalData(30);
  await render();
  setInterval(() => { if (document.visibilityState === 'visible' && getToken()) refreshTasks({ quiet: true }); }, 10000);
}
start().catch((error) => { view.innerHTML = emptyState('⚠', '启动失败', error.message); });
