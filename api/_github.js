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
  const { accept, seDiferente, ...resto } = opcoes;
  return fetch(`${API}/repos/${repo()}/contents/${caminho}`, {
    ...resto,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "validade-minatel",
      Accept: accept || "application/vnd.github+json",
      ...(seDiferente ? { "If-None-Match": seDiferente } : {}),
      ...(resto.body ? { "Content-Type": "application/json" } : {})
    }
  });
}

// Lê um arquivo. Devolve { sha, buf, etag } ou null se ainda não existir.
// Com "etag" (a marca da última leitura), devolve { igual: true } quando nada mudou:
// essa resposta curta não gasta o limite de consultas do GitHub, por isso os celulares podem perguntar a toda hora.
export async function lerArquivo(caminho, etag) {
  const r = await gh(caminho, etag ? { seDiferente: etag } : {});
  if (r.status === 304) return { igual: true, etag };
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}: ${await r.text()}`);
  const marca = r.headers.get("etag") || "";
  const j = await r.json();
  if (j.content && j.encoding === "base64") return { sha: j.sha, etag: marca, buf: Buffer.from(j.content, "base64") };
  const r2 = await gh(caminho, { accept: "application/vnd.github.raw+json" });
  if (!r2.ok) throw new Error(`GitHub respondeu ${r2.status}`);
  return { sha: j.sha, etag: marca, buf: Buffer.from(await r2.arrayBuffer()) };
}

// Grava um arquivo (cria ou substitui). Devolve a resposta do GitHub.
export function gravarArquivo(caminho, buf, sha, mensagem) {
  return gh(caminho, {
    method: "PUT",
    body: JSON.stringify({ message: mensagem, content: buf.toString("base64"), ...(sha ? { sha } : {}) })
  });
}

// Apaga um arquivo (precisa do sha atual dele).
export function apagarArquivo(caminho, sha, mensagem) {
  return gh(caminho, { method: "DELETE", body: JSON.stringify({ message: mensagem, sha }) });
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

// Traduz o erro do GitHub em um motivo que o app mostra para a pessoa.
export function erroGitHub(e) {
  const st = Number((/GitHub respondeu (\d+)/.exec(String(e && e.message)) || [])[1]);
  if (st === 401) return "token_invalido";
  if (st === 403) return /rate limit/i.test(e.message) ? "limite" : "sem_permissao";
  if (st === 404) return "repo_nao_achado";
  if (st === 429) return "limite";
  return "github";
}
