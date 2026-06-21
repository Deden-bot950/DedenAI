/* DedenAI — Function Server (API key tersembunyi di sini) */

const MODEL = 'gemini-2.0-flash-exp';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const resp = (code, obj) => ({
  statusCode: code,
  headers: CORS,
  body: JSON.stringify(obj)
});

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return resp(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) { return resp(400, { error: 'bad_json' }); }

  const mode = body.mode || 'generate';
  const GKEY = process.env.GEMINI_API_KEY || '';
  const QKEY = process.env.GROQ_API_KEY || '';

  try {

    /* STATUS — cek key terpasang */
    if (mode === 'status') {
      return resp(200, { ok: true, hasGemini: GKEY.length > 0, hasGroq: QKEY.length > 0, model: MODEL });
    }

    /* DIAG — uji Gemini nyata */
    if (mode === 'diag') {
      if (!GKEY) return resp(200, { ok: false, reason: 'GEMINI_API_KEY belum diisi di Netlify Environment Variables' });
      const result = await callGemini(GKEY, [{ text: 'a simple red circle on white background' }]);
      if (result.image) return resp(200, { ok: true, model: MODEL });
      return resp(200, { ok: false, reason: result.error });
    }

    /* ENHANCE — Groq perkaya prompt */
    if (mode === 'enhance') {
      if (!QKEY) return resp(200, { text: body.prompt || '' });
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + QKEY },
        body: JSON.stringify({
          model: GROQ_MODEL, temperature: 0.7, max_tokens: 200,
          messages: [
            { role: 'system', content: 'You enhance image generation prompts. Reply ONLY with the improved English prompt, rich in visual detail: subject, style, lighting, composition, quality. No explanation, no quotes.' },
            { role: 'user', content: String(body.prompt || '') }
          ]
        })
      });
      const d = await r.json();
      const text = ((d.choices || [])[0] || {}).message?.content?.trim() || '';
      return resp(200, { text: text || body.prompt });
    }

    /* PROXY — ambil gambar jadi base64 */
    if (mode === 'proxy') {
      if (!body.url) return resp(400, { error: 'no_url' });
      const r = await fetch(body.url);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type') || 'image/jpeg';
      return resp(200, { image: buf.toString('base64'), mime });
    }

    /* GENERATE / EDIT — Gemini */
    if (!GKEY) return resp(503, { error: 'no_key' });
    const parts = [];
    if (body.image) parts.push({ inline_data: { mime_type: body.imageMime || 'image/png', data: body.image } });
    parts.push({ text: body.prompt || 'Create a high quality detailed image' });
    const result = await callGemini(GKEY, parts);
    if (result.image) return resp(200, { image: result.image.data, mime: result.image.mime });
    return resp(502, { error: 'no_image', detail: result.error });

  } catch(e) {
    return resp(500, { error: 'crash', detail: String(e && e.message ? e.message : e) });
  }
};

async function callGemini(key, parts) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + key;
  const bodies = [
    { contents: [{ parts }] },
    { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }
  ];
  let lastErr = 'no response';
  for (const b of bodies) {
    let d;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      d = await r.json();
    } catch(e) { lastErr = 'fetch error: ' + (e.message || e); continue; }
    if (d && d.error) { lastErr = d.error.message || JSON.stringify(d.error); continue; }
    const cands = (d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    for (const p of cands) {
      const inl = p.inline_data || p.inlineData;
      if (inl && inl.data) return { image: { data: inl.data, mime: inl.mime_type || inl.mimeType || 'image/png' } };
    }
    lastErr = 'image not in response';
  }
  return { error: lastErr };
}
