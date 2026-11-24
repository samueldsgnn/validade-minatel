// Ajudantes para guardar os dados do app num repositório privado do GitHub.
// Precisa da variável GITHUB_TOKEN configurada na Vercel (e GITHUB_REPO, se o repositório tiver outro nome).

const API = "https://api.github.com";

export function configurado() {
  return !!process.env.GITHUB_TOKEN;
}

function repo() {
  return (process.env.GITHUB_REPO || "samueldsgnn/validade-dados").trim();
}

export function gh(caminho, opcoes = {}) {
  const { accept, ...resto } = opcoes;
  return fetch(`${API}/repos/${repo()}/contents/${caminho}`, {
    ...resto,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "validade-minatel",
      Accept: accept || "application/vnd.github+json",
      ...(resto.body ? { "Content-Type": "application/json" } : {})
    }
  });
}

// Lê um arquivo. Devolve { sha, buf } ou null se ainda não existir.
export async function lerArquivo(caminho) {
  const r = await gh(caminho);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.content && j.encoding === "base64") return { sha: j.sha, buf: Buffer.from(j.content, "base64") };
  const r2 = await gh(caminho, { accept: "application/vnd.github.raw+json" });
  if (!r2.ok) throw new Error(`GitHub respondeu ${r2.status}`);
  return { sha: j.sha, buf: Buffer.from(await r2.arrayBuffer()) };
}

// Grava um arquivo (cria ou substitui). Devolve a resposta do GitHub.
export function gravarArquivo(caminho, buf, sha, mensagem) {
  return gh(caminho, {
    method: "PUT",
    body: JSON.stringify({ message: mensagem, content: buf.toString("base64"), ...(sha ? { sha } : {}) })
  });
}

export function origemOk(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return new URL(origem).host === host;
  } catch (e) {
    return false;
  }
}

export function lerCorpo(req) {
  let c = req.body;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = {}; } }
  return c || {};
}
