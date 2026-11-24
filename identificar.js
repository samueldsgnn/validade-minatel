// Identifica o produto de supermercado a partir de uma foto, usando o Google Gemini.
// A chave fica guardada na Vercel (variável GEMINI_API_KEY), nunca no app.

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PROMPT = `Você é um conferente de supermercado no Brasil. Olhe a foto de um produto e identifique-o.
Responda SOMENTE com um JSON neste formato, sem texto antes ou depois:
{
  "encontrado": true,
  "nome": "nome do produto como aparece na embalagem, sem a marca e sem o tamanho (ex.: Iogurte Natural Integral)",
  "marca": "marca do produto (ex.: Nestlé)",
  "tamanho": { "numero": 170, "unidade": "g" },
  "codigo_barras": "somente os números do código de barras, se estiverem legíveis na foto, senão vazio",
  "validade": "data de validade impressa na embalagem no formato AAAA-MM-DD, se estiver legível, senão vazio"
}
Regras:
- "unidade" deve ser uma destas: g, kg, ml, L, un. Converta se precisar (ex.: 1,5 litro = 1.5 L).
- Se a embalagem mostrar só mês e ano na validade (ex.: 03/2027), use o último dia desse mês.
- Datas brasileiras são dia/mês/ano.
- Não invente: se não conseguir ler um campo, deixe "" (ou null no tamanho).
- Se a foto não mostrar um produto, responda {"encontrado": false}.`;

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
  if (req.method !== "POST") return res.status(405).json({ erro: "falha" });
  if (!origemPermitida(req)) return res.status(403).json({ erro: "falha" });

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return res.status(500).json({ erro: "sem_chave" });

  let corpo = req.body;
  if (typeof corpo === "string") {
    try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; }
  }
  const imagem = (corpo && corpo.imagem) || "";
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imagem);
  if (!m || imagem.length > 3500000) return res.status(400).json({ erro: "falha" });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    if (r.status === 429) return res.status(429).json({ erro: "limite" });
    if (!r.ok) {
      console.error("Gemini respondeu", r.status, await r.text());
      return res.status(502).json({ erro: "falha" });
    }
    const j = await r.json();
    const texto = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    const limpo = texto.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let dados;
    try { dados = JSON.parse(limpo); } catch (e) { return res.status(502).json({ erro: "falha" }); }

    const txt = v => (typeof v === "string" ? v.trim().slice(0, 120) : "");
    const tam = dados.tamanho && Number(dados.tamanho.numero) > 0 && ["g", "kg", "ml", "L", "un"].includes(dados.tamanho.unidade)
      ? { numero: Number(dados.tamanho.numero), unidade: dados.tamanho.unidade }
      : null;
    return res.status(200).json({
      encontrado: dados.encontrado !== false,
      nome: txt(dados.nome),
      marca: txt(dados.marca),
      tamanho: tam,
      codigo_barras: String(dados.codigo_barras || "").replace(/\D/g, "").slice(0, 14),
      validade: /^\d{4}-\d{2}-\d{2}$/.test(dados.validade || "") ? dados.validade : ""
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ erro: "falha" });
  }
}
