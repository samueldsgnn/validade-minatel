// Guarda as fotos tiradas pelo celular no repositório de dados e as devolve para os outros celulares.
import { configurado, gh, gravarArquivo, origemOk, lerCorpo, erroGitHub } from "./_github.js";

export default async function handler(req, res) {
  if (!configurado()) return res.status(503).json({ erro: "sem_token" });
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      const nome = String(req.query.f || "");
      if (!/^[A-Za-z0-9_-]{1,160}\.jpg$/.test(nome)) return res.status(400).end();
      // HEAD só confere se a foto ainda existe (usado ao restaurar um backup)
      if (req.method === "HEAD") {
        const h = await gh(`fotos/${nome}`, { method: "HEAD" });
        res.setHeader("Cache-Control", "no-store");
        return res.status(h.ok ? 200 : h.status === 404 ? 404 : 502).end();
      }
      const r = await gh(`fotos/${nome}`, { accept: "application/vnd.github.raw+json" });
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
      return res.status(200).send(buf);
    }
    if (req.method !== "POST") return res.status(405).end();
    if (!origemOk(req)) return res.status(403).json({ erro: "origem" });

    const { id, imagem } = lerCorpo(req);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(imagem || "");
    if (!m || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,130}$/.test(id) || imagem.length > 1500000) return res.status(400).json({ erro: "foto" });
    const nome = `${id}-${Date.now().toString(36)}.jpg`;
    const r = await gravarArquivo(`fotos/${nome}`, Buffer.from(m[1], "base64"), null, `Foto de ${id}`);
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);
    return res.status(200).json({ url: `/api/foto?f=${nome}` });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: erroGitHub(e) });
  }
}
