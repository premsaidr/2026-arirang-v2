/* ============================================================
 * JSD 2026 — Service Worker (Cloudflare Access 호환)
 * A안: 장기 세션 인증 + PWA 오프라인 작동
 *
 * 핵심 처리:
 *  - 인증 페이지(cloudflareaccess.com)는 캐싱 안 함
 *  - HTML 응답이 302/401이면 캐싱 안 함 (인증 리다이렉트 차단)
 *  - 인증된 응답만 캐싱하여 오프라인 시 안전하게 제공
 * ============================================================ */

const CACHE_NAME = 'jsd2026-v1.1.1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/en.html', '/ja.html', '/zh-hant.html', '/zh-hans.html',
  '/de.html', '/mn.html', '/es.html', '/fa.html',
  '/fr.html', '/vn.html', '/ru.html',
  '/favicon.svg',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/favicon-64.png',
  '/favicon-128.png',
  '/favicon-180.png',
  '/favicon-192.png',
  '/favicon-512.png',
  '/site.webmanifest',
];

/* ===== install ===== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL.map((url) => cache.add(url).catch((e) => console.warn('SW cache fail:', url, e)))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ===== activate ===== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

/* ===== 인증 응답 식별 — Cloudflare Access 리다이렉트 감지 ===== */
function isAuthRedirect(res) {
  if (!res) return false;
  // Access는 미인증 시 302 또는 401, body는 인증 페이지
  if (res.status === 401 || res.status === 403) return true;
  // 일부 케이스: Cloudflare Access 헤더
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  return false;
}

/* ===== fetch ===== */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 도메인 (YouTube, Cloudflare Access 등) 통과
  if (url.origin !== self.location.origin) return;

  // Cloudflare Access 콜백 경로는 절대 캐싱 안 함
  if (url.pathname.startsWith('/cdn-cgi/access/')) return;

  const accept = req.headers.get('accept') || '';
  const isHTML = accept.includes('text/html');

  if (isHTML) {
    /* HTML: network-first, 인증 통과한 응답만 캐싱 */
    event.respondWith(
      fetch(req).then((res) => {
        // 인증 리다이렉트나 에러 응답은 캐싱하지 않음
        if (res && res.status === 200 && !isAuthRedirect(res)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // 오프라인: 캐시된 정상 응답 반환 (이전 인증 세션 토큰으로 받은 것)
        return caches.match(req).then((cached) => cached || caches.match('/index.html'));
      })
    );
  } else {
    /* 정적 자원: cache-first */
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && !url.pathname.endsWith('.mp4') && !isAuthRedirect(res)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
