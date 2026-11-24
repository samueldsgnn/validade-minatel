// Guarda o app no celular para abrir rápido e funcionar mesmo sem internet.
const CACHE = "validade-v6";
const RECEBIDO = "validade-recebido";
const FOTOS = "validade-fotos-v1";
const ARQUIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FOTOS && k !== RECEBIDO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function primeiroCache(nome, req) {
  return caches.open(nome).then(c => c.match(req).then(r => r || fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; })));
}
// arquivo .validade compartilhado para o app (menu Compartilhar do Android): guarda e abre o app
async function receberCompartilhado(req) {
  try {
    const fd = await req.formData();
    const arq = fd.get("arquivo") || [...fd.values()].find(v => v && typeof v === "object" && "size" in v);
    if (arq) {
      const c = await caches.open(RECEBIDO);
      await c.put(new URL("__recebido", self.registration.scope).href, new Response(arq, { headers: { "x-nome": encodeURIComponent(arq.name || "arquivo.validade") } }));
    }
  } catch (err) {}
  return Response.redirect(new URL("./?receber=1", self.registration.scope).href, 303);
}
self.addEventListener("fetch", e => {
  if (e.request.method === "POST" && new URL(e.request.url).pathname.endsWith("/receber")) {
    e.respondWith(receberCompartilhado(e.request));
    return;
  }
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
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});

// ===== lembrete de backup com o app fechado (Android com o app instalado) =====
function lerKV(chave) {
  return new Promise(ok => {
    const r = indexedDB.open("validade-minatel", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => ok(null);
    r.onsuccess = () => {
      try { const q = r.result.transaction("kv").objectStore("kv").get(chave); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }
      catch (err) { ok(null); }
    };
  });
}
function proximoBackup(a) {
  const base = a.ultimo ? new Date(a.ultimo) : new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (a.ultimo ? a.freq : 0), a.hora, 0, 0);
  return Math.max(d.getTime(), a.adiado || 0);
}
async function lembrarBackup() {
  const a = await lerKV("autoBackup");
  if (!a || !a.freq || !a.n || (a.mudanca || 0) <= (a.ultimo || 0) || Date.now() < proximoBackup(a)) return;
  if (self.Notification && Notification.permission !== "granted") return;
  const abertos = await self.clients.matchAll({ type: "window" });
  if (abertos.some(c => c.visibilityState === "visible")) return; // o app aberto mostra o aviso ele mesmo
  await self.registration.showNotification("Hora de salvar o backup", {
    body: `${a.n} produto(s) com alterações. Toque para salvar tudo num arquivo no celular.`,
    icon: "icon-192.png", tag: "backup-validade", data: { acao: "backup" }
  });
}
self.addEventListener("periodicsync", e => { if (e.tag === "lembrete-backup") e.waitUntil(lembrarBackup()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = lista.find(c => c.url.startsWith(self.registration.scope));
    if (app) { await app.focus(); app.postMessage({ tipo: "salvarBackup" }); return; }
    await self.clients.openWindow(new URL("./?backup=1", self.registration.scope).href);
  })());
});
