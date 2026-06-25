// sw.js — オフライン利用のための簡易サービスワーカー（任意機能）。
// 方針: ネットワーク優先（network-first）。オンライン時は常に最新を取得し、
// 取得できたものをキャッシュへ保存。オフライン時のみキャッシュにフォールバックする。
// これにより「更新したのに古い画面が出る」問題を避けつつ、オフラインでも起動できる。

const CACHE = 'plo-equity-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './src/app.js',
  './src/ui.js',
  './src/chart.js',
  './src/worker.js',
  './src/cards.js',
  './src/evaluator.js',
  './src/range.js',
  './src/equity.js',
];

self.addEventListener('install', (e) => {
  // 1つでも取得失敗するとinstallごと失敗するのを避け、個別にキャッシュする
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((url) => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 正常応答のみキャッシュ更新（4xx/5xxを焼き付けない）
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => {
        if (cached) return cached;
        // ナビゲーション要求のみ index.html へフォールバック（JS等にHTMLを返さない）
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })),
  );
});
