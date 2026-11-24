// Guarda o app no celular para abrir rápido e funcionar mesmo sem internet.
const CACHE = "validade-v3";
const FOTOS = "validade-fotos-v1";
const ARQUIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function primeiroCache(nome, req) {
  return caches.open(nome).then(c => c.match(req).then(r => r || fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; })));
}
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  const mesmo = url.startsWith(self.location.origin);
  // fotos dos produtos (da internet ou tiradas pela equipe): guardadas no celular
  if (/images\.open(food|beauty|products)facts\.org/.test(url) || (mesmo && url.includes("/api/foto?"))) {
    e.respondWith(primeiroCache(FOTOS, e.request));
    return;
  }
  // leitor de fotos: baixa uma vez e guarda
  if (url.includes("tesseract")) { e.respondWith(primeiroCache(CACHE, e.request)); return; }
  // dados e buscas sempre direto na internet
  if ((mesmo && url.includes("/api/")) || /open(food|beauty|products)facts\.org/.test(url)) return;
  // o resto: busca a versão nova; sem sinal, usa a guardada
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && (mesmo || url.includes("html5-qrcode") || url.includes("fonts."))) {
        const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
