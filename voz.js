// Entende o que a pessoa falou no microfone e separa nos campos do cadastro, usando o Google Gemini.
// Usa a mesma chave da identificação por foto (variável GEMINI_API_KEY na Vercel).
// Se a chave não existir, o app separa os campos sozinho, no próprio celular.

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function hojeBR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function montarPrompt(texto, marcas) {
  return `Você ajuda um conferente de supermercado no Brasil a cadastrar produtos falando no celular.
O ditado por voz pode ter erros de reconhecimento: corrija palavras óbvias (ex.: "iorgute" = "Iogurte").
Hoje é ${hojeBR()}.
${marcas.length ? `Marcas já cadastradas na loja (use esta grafia se a pessoa falar uma delas): ${marcas.join(", ")}.\n` : ""}
Frase falada: """${texto}"""

Responda SOMENTE com um JSON neste formato, sem texto antes ou depois:
{
  "nome": "nome do produto, sem a marca e sem o tamanho, com iniciais maiúsculas (ex.: Iogurte Natural Integral)",
  "marca": "marca, se foi falada, senão vazio",
  "tamanho": { "numero": 170, "unidade": "g" },
  "quantidade": 12,
  "validade": "AAAA-MM-DD ou vazio"
}
Regras:
- "tamanho" é o peso ou volume de UMA embalagem (gramas, quilos, ml, litros). "unidade" deve ser uma destas: g, kg, ml, L, un.
  "meio quilo" = 500 g; "um quilo e meio" = 1.5 kg; "meio litro" = 500 ml; "um litro e meio" = 1.5 L. Se não falou, use null.
- "quantidade" é quantas embalagens tem no estoque (ex.: "12 unidades", "tem 5", "quantidade 8", "3 caixas"). Número inteiro. Se não falou, use 0.
- Não confunda: em "iogurte 170 gramas 12 unidades", 170 g é o tamanho e 12 é a quantidade.
- "validade": datas brasileiras são dia/mês/ano. Se falou só dia e mês, use o próximo que ainda não passou a partir de hoje.
  Se falou só mês e ano (ex.: "março de 2027"), use o último dia desse mês. Se não falou, deixe "".
- Não invente nada que não foi falado.`;
}

function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return new URL(origem).host === host;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "falha" });
  if (!origemPermitida(req)) return res.status(403).json({ erro: "falha" });

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return res.status(500).json({ erro: "sem_chave" });

  let corpo = req.body;
  if (typeof corpo === "string") {
    try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; }
  }
  const texto = String((corpo && corpo.texto) || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (texto.length < 2) return res.status(400).json({ erro: "falha" });
  const marcas = (Array.isArray(corpo.marcas) ? corpo.marcas : [])
    .filter(m => typeof m === "string").map(m => m.replace(/["\n\r]/g, "").trim().slice(0, 40)).filter(Boolean).slice(0, 80);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: montarPrompt(texto, marcas) }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(timer));
    if (r.status === 429) return res.status(429).json({ erro: "limite" });
    if (!r.ok) {
      console.error("Gemini respondeu", r.status, await r.text());
      return res.status(502).json({ erro: "falha" });
    }
    const j = await r.json();
    const saida = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    const limpo = saida.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let dados;
    try { dados = JSON.parse(limpo); } catch (e) { return res.status(502).json({ erro: "falha" }); }

    const txt = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const tam = dados.tamanho && Number(dados.tamanho.numero) > 0 && ["g", "kg", "ml", "L", "un"].includes(dados.tamanho.unidade)
      ? { numero: Number(dados.tamanho.numero), unidade: dados.tamanho.unidade }
      : null;
    const qtd = Math.max(0, Math.min(100000, parseInt(dados.quantidade, 10) || 0));
    return res.status(200).json({
      nome: txt(dados.nome, 160),
      marca: txt(dados.marca, 80),
      tamanho: tam,
      quantidade: qtd,
      validade: /^\d{4}-\d{2}-\d{2}$/.test(dados.validade || "") ? dados.validade : ""
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: "falha" });
  }
}
