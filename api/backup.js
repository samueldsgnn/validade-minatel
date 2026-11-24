// Cópias de segurança da lista de produtos, guardadas na pasta "backups" do repositório de dados.
// GET            → lista as cópias (mais nova primeiro)
// GET ?d=NOME    → devolve uma cópia
// POST           → cria a cópia do dia, se ainda não existir (os celulares chamam sozinhos uma vez por dia)
// POST {manual}  → cria uma cópia agora, com data e hora no nome
import { configurado, gh, lerArquivo, gravarArquivo, apagarArquivo, origemOk, lerCorpo } from "./_github.js";

const PASTA = "backups";
const NOME = /^\d{4}-\d{2}-\d{2}(-\d{4})?$/;
const GUARDAR_DIAS = 60;

function agoraBR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}${p.minute}` };
}

function lerProdutos(arq) {
  if (!arq || !arq.buf) return [];
  try { const j = JSON.parse(arq.buf.toString("utf8")); return Array.isArray(j.produtos) ? j.produtos : []; }
  catch (e) { return []; }
}

async function listar() {
  const r = await gh(PASTA);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : [])
    .filter(f => f.type === "file" && /\.json$/.test(f.name) && NOME.test(f.name.slice(0, -5)))
    .map(f => ({ nome: f.name.slice(0, -5), tamanho: f.size, sha: f.sha }))
    .sort((a, b) => b.nome.localeCompare(a.nome));
}

async function limparAntigas(copias) {
  const limite = new Date(Date.now() - GUARDAR_DIAS * 864e5).toISOString().slice(0, 10);
  const velhas = copias.filter(c => c.nome.slice(0, 10) < limite).slice(0, 5);
  for (const c of velhas) {
    try { await apagarArquivo(`${PASTA}/${c.nome}.json`, c.sha, `Backup antigo apagado: ${c.nome}`); } catch (e) {}
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!origemOk(req)) return res.status(403).json({ erro: "origem" });
  if (!configurado()) return res.status(503).json({ erro: "sem_token" });

  try {
    if (req.method === "GET") {
      const d = String(req.query.d || "");
      if (!d) return res.status(200).json({ copias: (await listar()).map(({ nome, tamanho }) => ({ nome, tamanho })) });
      if (!NOME.test(d)) return res.status(400).json({ erro: "nome" });
      const arq = await lerArquivo(`${PASTA}/${d}.json`);
      if (!arq) return res.status(404).json({ erro: "nao_existe" });
      const j = JSON.parse(arq.buf.toString("utf8"));
      return res.status(200).json({ nome: d, criado: j.criado || "", produtos: Array.isArray(j.produtos) ? j.produtos : [] });
    }
    if (req.method !== "POST") return res.status(405).json({ erro: "metodo" });

    const manual = !!lerCorpo(req).manual;
    const { dia, hora } = agoraBR();
    const nome = manual ? `${dia}-${hora}` : dia;
    const caminho = `${PASTA}/${nome}.json`;

    if (!manual) {
      const existe = await gh(caminho, { method: "HEAD" });
      if (existe.ok) return res.status(200).json({ ok: true, nome, ja: true });
    }

    const produtos = lerProdutos(await lerArquivo("produtos.json")).filter(p => p && !p.excluido);
    if (!produtos.length) return res.status(200).json({ ok: false, erro: "vazio" });

    const buf = Buffer.from(JSON.stringify({ app: "validade-minatel", tipo: "backup", criado: new Date().toISOString(), produtos }, null, 1));
    const r = await gravarArquivo(caminho, buf, null, `Backup ${manual ? "manual" : "do dia"}: ${nome} (${produtos.length} produtos)`);
    if (r.status === 422) return res.status(200).json({ ok: true, nome, ja: true }); // outro celular criou a do dia ao mesmo tempo
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);

    if (!manual) { try { await limparAntigas(await listar()); } catch (e) {} }
    return res.status(200).json({ ok: true, nome, produtos: produtos.length });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: "github" });
  }
}
