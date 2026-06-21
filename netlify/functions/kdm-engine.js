/* =====================================================================
   KDM MAC AI Engine  —  Mesin server (provider AI disembunyikan total)
   Memegang API key di server (environment variable) supaya AMAN & TERSEMBUNYI.

   Environment variables yang dipakai (set di Netlify > Site settings > Environment):
     GEMINI_API_KEY   -> wajib untuk buat/ubah gambar (dapat gratis di aistudio.google.com)
     GROQ_API_KEY     -> opsional, untuk fitur "Sempurnakan Prompt"

   Mode request (POST JSON):
     { mode:'generate', prompt }
     { mode:'edit',     prompt, image(base64 tanpa prefix), imageMime }
     { mode:'enhance',  prompt }                // Groq menyempurnakan prompt
     { mode:'proxy',    url }                   // ambil gambar -> base64 (anti-CORS)
===================================================================== */

const GEMINI_MODEL = 'gemini-2.5-flash-image';   // Nano Banana: buat + ubah gambar
const GROQ_MODEL   = 'llama-3.3-70b-versatile';  // teks cepat untuk sempurnakan prompt

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const ok  = (o) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(o) });
const err = (code, o) => ({ statusCode: code, headers: CORS, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return err(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return err(400, { error: 'bad_json' }); }
  const mode = body.mode || 'generate';

  try {
    /* ---------- SEMPURNAKAN PROMPT (Groq) ---------- */
    if (mode === 'enhance') {
      const key = process.env.GROQ_API_KEY;
      if (!key) return ok({ text: body.prompt || '' });
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.7,
          max_tokens: 220,
          messages: [
            { role: 'system', content: 'Kamu asisten yang menyempurnakan prompt gambar AI. Balas HANYA prompt final dalam bahasa Inggris, kaya detail visual: subjek, gaya, pencahayaan, komposisi, kualitas tinggi. Tanpa penjelasan, tanpa tanda kutip.' },
            { role: 'user', content: String(body.prompt || '') }
          ]
        })
      });
      const d = await r.json();
      const text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
      return ok({ text: text || body.prompt });
    }

    /* ---------- PROXY GAMBAR -> BASE64 (anti-CORS untuk watermark) ---------- */
    if (mode === 'proxy') {
      if (!body.url) return err(400, { error: 'no_url' });
      const r = await fetch(body.url);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type') || 'image/jpeg';
      return ok({ image: buf.toString('base64'), mime });
    }

    /* ---------- BUAT / UBAH GAMBAR (Gemini) ---------- */
    const key = process.env.GEMINI_API_KEY;
    if (!key) return err(503, { error: 'no_key' });   // -> frontend fallback ke mesin tanpa-key

    const parts = [];
    if (body.image) parts.push({ inline_data: { mime_type: body.imageMime || 'image/png', data: body.image } });
    parts.push({ text: body.prompt || 'Buat gambar berkualitas tinggi, detail tajam' });

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + key;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] }
      })
    });
    const d = await r.json();
    if (d.error) return err(502, { error: 'engine', detail: d.error.message });

    const cand = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    let img = null, mime = 'image/png';
    for (const p of cand) {
      const inl = p.inline_data || p.inlineData;
      if (inl && inl.data) { img = inl.data; mime = inl.mime_type || inl.mimeType || mime; break; }
    }
    if (!img) return err(502, { error: 'no_image' });
    return ok({ image: img, mime });

  } catch (e) {
    return err(500, { error: 'server', detail: String(e && e.message || e) });
  }
};
