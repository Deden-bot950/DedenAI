# KDM MAC AI Engine — Panduan Deploy

Aplikasi: buat gambar, ubah gambar, gambar jadi video. Mesin AI (Gemini/Groq) **disembunyikan** lewat Netlify Function. Watermark **KDM MAC** menempel permanen.

## Isi folder
- `index.html` — aplikasi (frontend)
- `netlify/functions/kdm-engine.js` — mesin server (menyimpan API key, tersembunyi)
- `netlify.toml` — konfigurasi Netlify

## Cara deploy (lewat GitHub — disarankan)
1. Buat repo baru di GitHub (mis. `kdm-mac-ai-engine`), upload **semua** isi folder ini.
2. Netlify → Add new site → Import from GitHub → pilih repo.
3. Build command: kosongkan. Publish directory: `.` (titik). Deploy.

## Pasang API key GRATIS (agar mesin Pro aktif)
1. Buka **aistudio.google.com** → login Google → **Get API key** → buat & salin key.
2. Netlify → Site → **Site settings → Environment variables → Add**:
   - Key: `GEMINI_API_KEY`  → Value: (tempel key Gemini)
   - (opsional) Key: `GROQ_API_KEY` → Value: key dari **console.groq.com** untuk fitur "Sempurnakan Prompt".
3. **Deploys → Trigger deploy → Clear cache and deploy**. Selesai.

> Tanpa key pun aplikasi tetap jalan memakai **mesin gratis** otomatis. Dengan key Gemini, kualitas lebih tinggi & fitur **Ubah Gambar mengedit foto asli**.

## Login admin bawaan
`admin@kdm.id` / `adminkdm` — ganti setelah login pertama.

## Catatan
- Model gambar Gemini bisa diganti di baris `GEMINI_MODEL` (mis. `gemini-3.1-flash-image`) di file `kdm-engine.js`.
- Free tier Gemini punya batas harian; jika habis, aplikasi otomatis pakai mesin gratis.
- Fitur video paling lancar di **Chrome** (Android/desktop).
