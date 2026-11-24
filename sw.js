// Guarda o app no celular para abrir rápido e funcionar mesmo sem internet.
const CACHE = "validade-v1";
const ARQUIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Busca a versão nova na internet; se estiver sem sinal, usa a guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes("html5-qrcode") || e.request.url.includes("fonts."))) {
        const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
