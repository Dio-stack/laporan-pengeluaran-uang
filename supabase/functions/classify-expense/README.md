# 🤖 classify-expense — Supabase Edge Function

Fungsi ini digunakan untuk mengklasifikasikan struk belanja dari foto menggunakan Google Gemini AI.

## 📍 Lokasi

`supabase/functions/classify-expense/index.ts`

## 🚀 Cara Deploy

```bash
supabase functions deploy classify-expense
```

## ⚙️ Environment Variables

Fungsi ini membutuhkan environment variables berikut (set di Supabase Dashboard):

| Variable | Deskripsi |
|----------|-----------|
| `SUPABASE_URL` | URL project Supabase Anda |
| `SUPABASE_ANON_KEY` | Anon key Supabase Anda |
| `GEMINI_API_KEY` | API key Gemini AI (Google AI Studio) |
| `APINEX_API_KEY` | (Opsional) API key Apinex sebagai fallback |

## 📥 Request Format

```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "mimeType": "image/jpeg",
  "customApiKey": ""
}
```

## 📤 Response Format

```json
{
  "date": "2026-11-03",
  "name": "Indomaret",
  "amount": 25000,
  "category": "makanan",
  "rawText": "..."
}
```

## 🔍 Cara Kerja

1. Menerima foto struk dalam format base64
2. Mengirim ke Google Gemini API untuk dianalisis
3. Mengekstrak: tanggal, nama toko, nominal, kategori
4. **Mencatat penggunaan AI ke tabel `ai_usage_logs`** (untuk monitoring quota)
5. Mengembalikan hasil dalam format JSON

## 📊 AI Usage Tracking

Setiap request yang berhasil akan dicatat di tabel `ai_usage_logs`:

| Column | Deskripsi |
|--------|-----------|
| `user_id` | ID user yang melakukan request |
| `request_date` | Tanggal request |
| `tokens_used` | Estimasi token yang dipakai |
| `model_used` | Model Gemini yang digunakan |
| `status` | 'success' atau 'failed' |
| `error_message` | Pesan error (jika gagal) |

## 🛡️ Error Handling

- Jika Gemini API gagal → fallback ke model lain
- Jika semua model gagal → fallback ke Apinex
- Jika Apinex juga gagal → return error JSON

## 🔗 Dipakai Oleh

- `app.js` (halaman utama) — untuk klasifikasi struk

## 📝 Catatan

- Estimasi token: 1 token ≈ 3-4 karakter (Indonesia/Inggris)
- Jika logging gagal, request tetap berhasil (tidak throw error)
