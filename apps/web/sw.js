// DSH Watch Service Worker锛歅WA 缂撳瓨 + Web Push 閫氱煡 + 鐐瑰嚮娣遍摼銆?
const CACHE = 'dsh-watch-v7';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.pathname.startsWith('/v1/')) return; // 涓氬姟鏁版嵁姘歌繙璧扮綉缁?
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); } catch { return (await caches.match('/index.html')) || Response.error(); }
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

// ---------------- IndexedDB锛堜笌 app.js 鍏辩敤 dsh-watch 搴擄級 ----------------
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
  succeeded: { title: '浠诲姟宸插畬鎴?, summary: '鎵撳紑 DSH Watch 鏌ョ湅缁撴灉' },
  failed: { title: '浠诲姟鎵ц澶辫触', summary: '鎵撳紑 DSH Watch 鏌ョ湅鍘熷洜' },
  cancelled: { title: '浠诲姟宸插彇娑?, summary: '鎵撳紑 DSH Watch 鏌ョ湅璇︽儏' },
  waiting_input: { title: '闇€瑕佷綘澶勭悊', summary: '浠诲姟鍦ㄧ瓑浣犺緭鍏?路 璇峰湪鐢佃剳缁х画' },
  waiting_approval: { title: '闇€瑕佷綘澶勭悊', summary: '浠诲姟鍦ㄧ瓑瀹℃壒 路 璇峰湪鐢佃剳缁х画' },
};

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
    const kind = payload.kind || 'unknown';
    const taskId = payload.task || '';
    const eventId = payload.event || (taskId + ':' + kind + ':' + Date.now());
    const text = KIND_TEXT[kind] || { title: 'DSH Watch 鎻愰啋', summary: '鎵撳紑鏌ョ湅璇︽儏' };

    const settingsRecord = await idbGet('meta', 'settings');
    const settings = settingsRecord && settingsRecord.value ? settingsRecord.value : {};
    const notify = settings.notify || { succeeded: true, failed: true, waiting: true };
    const enabled = kind === 'succeeded' ? notify.succeeded !== false
      : (kind === 'failed' || kind === 'cancelled') ? notify.failed !== false
        : (kind === 'waiting_input' || kind === 'waiting_approval') ? notify.waiting !== false
          : true;

    // 鎻愰啋璁板綍濮嬬粓鍐欏叆锛堝嵆浣跨郴缁熼€氱煡鍏抽棴锛夛紝浣滀负鍏滃簳
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
      body: privacy ? '鎵撳紑 DSH Watch 鏌ョ湅璇︽儏' : text.summary,
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
  const target = '/#/task/' + encodeURIComponent(data.task || '') + '?from=reminder&kind=' + encodeURIComponent(data.kind || '');
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = clientList.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOrigin) {
      try { await sameOrigin.focus(); await sameOrigin.navigate(target); return; } catch { /* fall through */ }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});



