// Guarda o app no celular para abrir rápido e funcionar mesmo sem internet.
const CACHE = "validade-v2";
const FOTOS = "validade-fotos-v1";
const ARQUIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  // fotos dos produtos: usa a guardada e só baixa se ainda não tiver
  if (url.includes("images.openfoodfacts.org") || url.includes("images.openbeautyfacts.org") || url.includes("images.openproductsfacts.org")) {
    e.respondWith(caches.open(FOTOS).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok || res.type === "opaque") c.put(e.request, res.clone()); return res; }))));
    return;
  }
  // buscas de produto vão sempre direto para a internet
  if (url.includes("openfoodfacts.org") || url.includes("openbeautyfacts.org") || url.includes("openproductsfacts.org")) return;
  // o resto: busca a versão nova; sem sinal, usa a guardada
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (url.startsWith(self.location.origin) || url.includes("html5-qrcode") || url.includes("fonts."))) {
        const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
