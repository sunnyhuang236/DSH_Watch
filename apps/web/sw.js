// DSH Watch Service Worker: PWA 缓存 + Web Push 通知 + 点击深链
const CACHE = 'dsh-watch-v7';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/')) return; // 业务数据永远走网络
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  })());
});

// ---------------- IndexedDB（与 app.js 共用 dsh-watch 库） ----------------
function openDB() {
  return new Promise((resolve, reject) => {
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
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result || null);
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

const KIND_TEXT = {
  succeeded: { title: '任务已完成', summary: '打开 DSH Watch 查看结果' },
  failed: { title: '任务执行失败', summary: '打开 DSH Watch 查看原因' },
  cancelled: { title: '任务已取消', summary: '打开 DSH Watch 查看详情' },
  waiting_input: { title: '需要你处理', summary: '任务在等你输入 · 请在电脑继续' },
  waiting_approval: { title: '需要你处理', summary: '任务在等审批 · 请在电脑继续' },
};

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = {};
    }
    const kind = payload.kind || 'unknown';
    const taskId = payload.task || '';
    const eventId = payload.event || (taskId + ':' + kind + ':' + Date.now());
    const text = KIND_TEXT[kind] || { title: 'DSH Watch 提醒', summary: '打开查看详情' };

    const settingsRecord = await idbGet('meta', 'settings');
    const settings = settingsRecord && settingsRecord.value ? settingsRecord.value : {};
    const notify = settings.notify || { succeeded: true, failed: true, waiting: true };
    const enabled = kind === 'succeeded'
      ? notify.succeeded !== false
      : (kind === 'failed' || kind === 'cancelled')
        ? notify.failed !== false
        : (kind === 'waiting_input' || kind === 'waiting_approval')
          ? notify.waiting !== false
          : true;

    // 提醒记录始终写入（即使系统通知关闭），作为兜底
    await idbPut('reminders', {
      record_id: 'evt:' + eventId,
      event_id: eventId,
      task_id: taskId,
      kind,
      title: text.title,
      summary: text.summary,
      created_at: Date.now(),
      read_at: null,
      handled: false,
    });

    if (!enabled) return;
    const privacy = settings.hideContent !== false;
    await self.registration.showNotification(privacy ? 'DSH Watch' : text.title, {
      body: privacy ? '打开 DSH Watch 查看详情' : text.summary,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'dsh-watch:' + eventId,
      data: { task: taskId, event: eventId, kind },
      renotify: false,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = '/#/task/' + encodeURIComponent(data.task || '')
    + '?from=reminder&kind=' + encodeURIComponent(data.kind || '');
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = clientList.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOrigin) {
      try {
        await sameOrigin.focus();
        await sameOrigin.navigate(target);
        return;
      } catch {
        // fall through to openWindow
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
