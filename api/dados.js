// Guarda e devolve a lista de produtos (produtos.json no repositório de dados).
// Cada celular manda só o que mudou; aqui as mudanças são juntas pela hora da alteração.
import { configurado, lerArquivo, gravarArquivo, origemOk, lerCorpo, erroGitHub } from "./_github.js";

const ARQUIVO = "produtos.json";
const ESPERA = ms => new Promise(ok => setTimeout(ok, ms));

function lerLista(arq) {
  if (!arq) return [];
  try { const j = JSON.parse(arq.buf.toString("utf8")); return Array.isArray(j.produtos) ? j.produtos : []; }
  catch (e) { return []; }
}

function limpar(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !/^[A-Za-z0-9_-]{1,130}$/.test(p.id)) return null;
  if (p.excluido) return { id: p.id, excluido: true, atualizado: Number(p.atualizado) || Date.now() };
  const foto = typeof p.foto === "string" && !p.foto.startsWith("data:") ? p.foto.slice(0, 600) : undefined;
  const txt = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const lotes = Array.isArray(p.lotes) ? p.lotes.slice(0, 200).filter(l => l && /^\d{4}-\d{2}-\d{2}$/.test(l.validade)).map(l => ({
    id: txt(l.id, 40) || Math.random().toString(36).slice(2, 10), validade: l.validade, qtd: Math.max(0, Math.min(100000, parseInt(l.qtd, 10) || 0))
  })) : [];
  const o = { id: p.id, nome: txt(p.nome, 160), marca: txt(p.marca, 80), tamanho: txt(p.tamanho, 30), codigo: txt(p.codigo, 20), lotes,
    criado: Number(p.criado) || undefined, atualizado: Number(p.atualizado) || Date.now() };
  if (foto !== undefined) o.foto = foto;
  return o;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!origemOk(req)) return res.status(403).json({ erro: "origem" });
  if (!configurado()) return res.status(503).json({ erro: "sem_token" });

  try {
    if (req.method === "GET") {
      // o celular manda a marca da última lista que recebeu; se nada mudou, a resposta é só { igual: true }
      const etag = String(req.query.etag || "").slice(0, 200);
      const arq = await lerArquivo(ARQUIVO, etag || undefined);
      if (arq && arq.igual) return res.status(200).json({ igual: true, etag });
      return res.status(200).json({ produtos: lerLista(arq), etag: (arq && arq.etag) || "" });
    }
    if (req.method !== "POST") return res.status(405).json({ erro: "metodo" });

    const corpo = lerCorpo(req);
    const mudancas = (Array.isArray(corpo.mudancas) ? corpo.mudancas : []).slice(0, 100).map(limpar).filter(Boolean);
    if (!mudancas.length) return res.status(400).json({ erro: "vazio" });

    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const arq = await lerArquivo(ARQUIVO);
      const mapa = new Map(lerLista(arq).map(p => [p.id, p]));
      for (const m of mudancas) {
        const atual = mapa.get(m.id);
        if (atual && (atual.atualizado || 0) > m.atualizado) continue; // a versão guardada é mais nova
        if (!m.excluido && m.foto === undefined && atual && atual.foto) m.foto = atual.foto;
        mapa.set(m.id, m);
      }
      // apaga marcas de exclusão com mais de 60 dias
      const limite = Date.now() - 60 * 864e5;
      const produtos = [...mapa.values()].filter(p => !(p.excluido && p.atualizado < limite));
      const buf = Buffer.from(JSON.stringify({ atualizado: new Date().toISOString(), produtos }, null, 1));
      const r = await gravarArquivo(ARQUIVO, buf, arq && arq.sha, `Estoque: ${mudancas.length} alteração(ões)`);
      if (r.ok) return res.status(200).json({ produtos });
      if (r.status === 409 || r.status === 422) { await ESPERA(300 + Math.random() * 700); continue; } // outro celular gravou ao mesmo tempo
      throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);
    }
    return res.status(409).json({ erro: "conflito" });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: erroGitHub(e) });
  }
}
