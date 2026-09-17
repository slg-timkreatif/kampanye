/* ============================================================
   SERVICE WORKER — Guru Berbagi Selogiri
   Version: 3.4.0

   Strategi:
   - HTML halaman        → network-first, fallback cache
   - CDN (jsdelivr, dll) → cache-first, dynamic caching
   - Google Fonts        → cache-first
   - Analytics           → dilewati (jangan di-cache)
   - Gambar user/CDN     → cache-first, TTL longgar
   - Default             → cache-first, fallback network
   ============================================================ */

const CACHE_VERSION = 'gbs-v3.4.0';
const CACHE_STATIC  = CACHE_VERSION + '-static';
const CACHE_DYNAMIC = CACHE_VERSION + '-dynamic';
const CACHE_IMAGE   = CACHE_VERSION + '-image';

/* File yang di-precache saat install */
const PRECACHE = [
  './',
  './index.html',
  './admin.html',
  './dashboard.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/gh/slg-timkreatif/app@main/1768315347206.png'
];

/* ============================================================
   INSTALL — Precache file inti
   ============================================================ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        // addAll gagal total kalau salah satu URL 404, jadi add satu-satu
        return Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Gagal precache:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ============================================================
   ACTIVATE — Bersihkan cache versi lama
   ============================================================ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ============================================================
   FETCH — Strategi per jenis request
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya handle GET
  if (req.method !== 'GET') return;

  // Skip non-HTTP requests (chrome-extension, dsb)
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  // 1️⃣ Analytics — JANGAN di-cache
  if (
    url.hostname.includes('goatcounter') ||
    url.hostname.includes('gc.zgo.at')
  ) {
    return; // biarkan network yang handle
  }

  // 2️⃣ Upload ke catbox.moe & API eksternal — JANGAN di-cache
  if (
    url.hostname.includes('catbox.moe') ||
    url.hostname.includes('qrserver.com') ||
    url.hostname.includes('script.google.com')
  ) {
    return;
  }

  // 3️⃣ CDN (jsdelivr, unpkg, cdnjs) — cache-first, dynamic cache
  if (
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(cacheFirst(req, CACHE_DYNAMIC));
    return;
  }

  // 4️⃣ Google Fonts — cache-first (font files jarang berubah)
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(cacheFirst(req, CACHE_DYNAMIC));
    return;
  }

  // 5️⃣ Gambar eksternal (imgbb, cloudinary, placehold, dsb) — cache-first
  if (req.destination === 'image' || url.hostname.includes('placehold.co')) {
    event.respondWith(cacheFirst(req, CACHE_IMAGE));
    return;
  }

  // 6️⃣ Same-origin HTML — network-first, fallback cache
  if (url.origin === self.location.origin) {
    // Kalau request HTML
    if (
      req.headers.get('accept')?.includes('text/html') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/' ||
      url.pathname.endsWith('/')
    ) {
      event.respondWith(networkFirstHTML(req));
      return;
    }

    // Aset same-origin lain (JSON, txt, dll) — cache-first
    event.respondWith(cacheFirst(req, CACHE_STATIC));
    return;
  }

  // 7️⃣ Default — cache-first dengan fallback network
  event.respondWith(cacheFirst(req, CACHE_DYNAMIC));
});

/* ============================================================
   STRATEGI: Cache First
   Cek cache dulu → kalau tidak ada, fetch + simpan ke cache
   ============================================================ */
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    // Hanya simpan response yang valid
    if (res && res.status === 200 && res.type !== 'opaque') {
      const clone = res.clone();
      caches.open(cacheName).then((cache) => {
        cache.put(req, clone).catch(() => {
          // Beberapa response tidak bisa di-cache (opaque, partial)
        });
      });
    }
    return res;
  } catch (err) {
    // Offline & tidak ada di cache
    return new Response('Offline — aset belum tersedia.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* ============================================================
   STRATEGI: Network First (khusus HTML)
   Coba network → kalau gagal, pakai cache
   Tujuan: konten selalu segar, tapi tetap bisa offline
   ============================================================ */
async function networkFirstHTML(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const clone = res.clone();
      caches.open(CACHE_STATIC).then((cache) => {
        cache.put(req, clone).catch(() => {});
      });
    }
    return res;
  } catch (err) {
    // Offline → coba cache
    const cached = await caches.match(req);
    if (cached) return cached;

    // Fallback terakhir: index.html (kalau user buka URL lain saat offline)
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;

    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:40px;background:#F6F5F9;color:#14121A;">' +
      '<h1>📵 Tidak Ada Koneksi</h1>' +
      '<p>Aktifkan internet lalu muat ulang halaman.</p>' +
      '</body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
}

/* ============================================================
   MESSAGE — Komunikasi dari halaman
   Contoh dari halaman: sw.postMessage({ type: 'SKIP_WAITING' })
   ============================================================ */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => caches.delete(k)))
      ).then(() => {
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: 'CACHE_CLEARED' });
        }
      })
    );
  }
});

/* ============================================================
   PUSH NOTIFICATION (opsional, masa depan)
   ============================================================ */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { return; }

  const title = data.title || 'Guru Berbagi Selogiri';
  const options = {
    body: data.body || '',
    icon: data.icon || 'https://cdn.jsdelivr.net/gh/slg-timkreatif/app@main/1768315347206.png',
    badge: 'https://cdn.jsdelivr.net/gh/slg-timkreatif/app@main/1768315347206.png',
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      // Kalau sudah ada tab terbuka, fokus ke situ
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Kalau belum, buka tab baru
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ============================================================
   LOG — biar gampang debug di DevTools
   ============================================================ */
self.addEventListener('error', (event) => {
  console.error('[SW] Error:', event.message, event.filename, event.lineno);
});

console.log('[SW] Service Worker Guru Berbagi Selogiri v3.4.0 dimuat.');