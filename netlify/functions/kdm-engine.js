/* DedenAI — Function Server v3
   ENV VARS (Netlify → Site settings → Environment variables):
   SILICONFLOW_API_KEY  → buat gambar + edit foto + video AI (daftar gratis: siliconflow.com, dapat ¥14 kredit)
   GEMINI_API_KEY       → buat gambar (opsional, backup)
   HF_API_KEY           → edit foto instruct-pix2pix (opsional, backup)
   GROQ_API_KEY         → perkaya deskripsi teks (opsional, gratis: console.groq.com)
*/

const SF_BASE   = 'https://api.siliconflow.com/v1';
const SF_IMG_MODEL   = 'Qwen/Qwen-Image';
const SF_EDIT_MODEL  = 'Qwen/Qwen-Image-Edit';
const SF_VID_MODEL   = 'wan-ai/Wan2.1-I2V-14B-480P';
const GEMINI_MODEL   = 'gemini-2.5-flash-image';
const GROQ_MODEL     = 'llama-3.3-70b-versatile';

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json'
};
const resp = (c,o) => ({ statusCode:c, headers:CORS, body:JSON.stringify(o) });

exports.handler = async function(event) {
  if (event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS,body:''};
  if (event.httpMethod!=='POST')    return resp(405,{error:'method_not_allowed'});

  let body={};
  try{ body=JSON.parse(event.body||'{}'); }catch(e){ return resp(400,{error:'bad_json'}); }

  const mode  = body.mode||'generate';
  const SFKEY = process.env.SILICONFLOW_API_KEY||'';
  const GKEY  = process.env.GEMINI_API_KEY||'';
  const HFKEY = process.env.HF_API_KEY||'';
  const QKEY  = process.env.GROQ_API_KEY||'';

  try {

    /* ── STATUS ── */
    if (mode==='status') {
      return resp(200,{ok:true,hasSF:!!SFKEY,hasGemini:!!GKEY,hasHF:!!HFKEY,hasGroq:!!QKEY});
    }

    /* ── PROXY (gambar URL → base64) ── */
    if (mode==='proxy') {
      if (!body.url) return resp(400,{error:'no_url'});
      const r=await fetch(body.url);
      const buf=Buffer.from(await r.arrayBuffer());
      return resp(200,{image:buf.toString('base64'),mime:r.headers.get('content-type')||'image/jpeg'});
    }

    /* ── ENHANCE (Groq) ── */
    if (mode==='enhance') {
      if (!QKEY) return resp(200,{text:body.prompt||''});
      const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+QKEY},
        body:JSON.stringify({
          model:GROQ_MODEL,temperature:0.7,max_tokens:200,
          messages:[
            {role:'system',content:'Enhance image generation prompts. Reply ONLY with improved English prompt, rich visual detail. No explanation, no quotes.'},
            {role:'user',content:String(body.prompt||'')}
          ]
        })
      });
      const d=await r.json();
      const text=((d.choices||[])[0]||{}).message?.content?.trim()||'';
      return resp(200,{text:text||body.prompt});
    }

    /* ── GENERATE GAMBAR ── */
    if (mode==='generate') {
      const prompt=body.prompt||'beautiful photo, high quality';

      // SiliconFlow Qwen-Image (utama)
      if (SFKEY) {
        const r=await fetch(SF_BASE+'/images/generations',{
          method:'POST',
          headers:{'Authorization':'Bearer '+SFKEY,'Content-Type':'application/json'},
          body:JSON.stringify({
            model:SF_IMG_MODEL,
            prompt:prompt,
            image_size:'1024x1024',
            batch_size:1,
            num_inference_steps:20,
            guidance_scale:7.5
          })
        });
        const d=await r.json();
        if (d&&d.images&&d.images[0]&&d.images[0].url) {
          // ambil gambar lewat proxy
          const ir=await fetch(d.images[0].url);
          const buf=Buffer.from(await ir.arrayBuffer());
          return resp(200,{image:buf.toString('base64'),mime:'image/png',engine:'sf-qwen'});
        }
      }

      // Gemini fallback
      if (GKEY) {
        const r=await callGemini(GKEY,[{text:prompt+'. Photorealistic, high quality.'}]);
        if (r.image) return resp(200,{image:r.image.data,mime:r.image.mime,engine:'gemini'});
      }

      // Tidak ada key → frontend pakai Pollinations
      return resp(200,{fallback:true,prompt});
    }

    /* ── EDIT GAMBAR ── */
    if (mode==='edit') {
      if (!body.image) return resp(400,{error:'no_image'});
      const instruction=body.prompt||'';

      // SiliconFlow Qwen-Image-Edit (utama)
      if (SFKEY) {
        const r=await fetch(SF_BASE+'/images/edits',{
          method:'POST',
          headers:{'Authorization':'Bearer '+SFKEY,'Content-Type':'application/json'},
          body:JSON.stringify({
            model:SF_EDIT_MODEL,
            image:'data:'+(body.imageMime||'image/png')+';base64,'+body.image,
            prompt:instruction+'. Keep all people, background, and composition exactly the same. Only change what is specifically requested.',
            num_inference_steps:25,
            guidance_scale:7.5
          })
        });
        const d=await r.json();
        if (d&&d.images&&d.images[0]&&d.images[0].url) {
          const ir=await fetch(d.images[0].url);
          const buf=Buffer.from(await ir.arrayBuffer());
          return resp(200,{image:buf.toString('base64'),mime:'image/png',engine:'sf-qwen-edit'});
        }
        if (d&&d.images&&d.images[0]&&d.images[0].b64_json) {
          return resp(200,{image:d.images[0].b64_json,mime:'image/png',engine:'sf-qwen-edit'});
        }
      }

      // HF instruct-pix2pix fallback
      if (HFKEY) {
        const r=await fetch('https://api-inference.huggingface.co/models/timbrooks/instruct-pix2pix',{
          method:'POST',
          headers:{'Authorization':'Bearer '+HFKEY,'Content-Type':'application/json'},
          body:JSON.stringify({
            inputs:body.image,
            parameters:{prompt:instruction,negative_prompt:'blurry,low quality',image_guidance_scale:1.5,guidance_scale:7.5,num_inference_steps:20}
          })
        });
        if (r.ok) {
          const ct=r.headers.get('content-type')||'image/png';
          if (ct.includes('image')) {
            const buf=Buffer.from(await r.arrayBuffer());
            return resp(200,{image:buf.toString('base64'),mime:ct,engine:'hf-pix2pix'});
          }
        }
      }

      // Gemini edit fallback
      if (GKEY) {
        const parts=[
          {inline_data:{mime_type:body.imageMime||'image/png',data:body.image}},
          {text:'Edit this photo: '+instruction+'. Keep all people, background, lighting exactly the same. Only change what is requested.'}
        ];
        const r=await callGemini(GKEY,parts);
        if (r.image) return resp(200,{image:r.image.data,mime:r.image.mime,engine:'gemini'});
      }

      return resp(200,{fallback:true,prompt:instruction});
    }

    /* ── SUBMIT VIDEO AI (async) ── */
    if (mode==='video_submit') {
      if (!SFKEY) return resp(503,{error:'no_sf_key',msg:'Tambah SILICONFLOW_API_KEY di Netlify env vars'});
      if (!body.image) return resp(400,{error:'no_image'});

      const prompt=body.prompt||'smooth cinematic camera motion, high quality video';
      const imageData='data:'+(body.imageMime||'image/png')+';base64,'+body.image;

      const r=await fetch(SF_BASE+'/video/submit',{
        method:'POST',
        headers:{'Authorization':'Bearer '+SFKEY,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:SF_VID_MODEL,
          image:imageData,
          prompt:prompt,
          negative_prompt:'blurry, low quality, distorted, watermark',
          seed:Math.floor(Math.random()*999999),
          image_size:'1280x720'
        })
      });
      const d=await r.json();
      if (d&&d.requestId) return resp(200,{requestId:d.requestId,status:'submitted'});
      if (d&&d.request_id) return resp(200,{requestId:d.request_id,status:'submitted'});
      return resp(502,{error:'submit_failed',detail:JSON.stringify(d).slice(0,200)});
    }

    /* ── CEK STATUS VIDEO ── */
    if (mode==='video_status') {
      if (!SFKEY) return resp(503,{error:'no_sf_key'});
      if (!body.requestId) return resp(400,{error:'no_request_id'});

      const r=await fetch(SF_BASE+'/video/status/'+body.requestId,{
        headers:{'Authorization':'Bearer '+SFKEY}
      });
      const d=await r.json();
      // status: InQueue | InProgress | Succeed | Failed
      const status=d.status||d.state||'unknown';
      if (status==='Succeed'||status==='completed') {
        const videos=(d.results&&d.results.videos)||d.videos||[];
        const url=(videos[0]&&(videos[0].url||videos[0]))||'';
        return resp(200,{status:'done',videoUrl:url});
      }
      if (status==='Failed'||status==='failed') {
        return resp(200,{status:'failed',reason:d.reason||d.message||'Gagal'});
      }
      return resp(200,{status:'processing',state:status});
    }

    return resp(400,{error:'unknown_mode'});

  } catch(e) {
    return resp(500,{error:'crash',detail:String(e&&e.message?e.message:e)});
  }
};

async function callGemini(key,parts) {
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+GEMINI_MODEL+':generateContent?key='+key;
  const bodies=[{contents:[{parts}]},{contents:[{parts}],generationConfig:{responseModalities:['IMAGE','TEXT']}}];
  let lastErr='no response';
  for (const b of bodies) {
    let d;
    try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});d=await r.json();}
    catch(e){lastErr='fetch:'+e.message;continue;}
    if (d&&d.error){lastErr=d.error.message||JSON.stringify(d.error);continue;}
    const cands=((d&&d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts)||[]);
    for (const p of cands){const inl=p.inline_data||p.inlineData;if(inl&&inl.data)return{image:{data:inl.data,mime:inl.mime_type||inl.mimeType||'image/png'}};}
    lastErr='image not in response';
  }
  return{error:lastErr};
}
