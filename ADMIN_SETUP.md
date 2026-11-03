# 🌸 Laporan Pengeluaran Uang — Admin Panel Setup Guide

Website pencatat pengeluaran uang dengan fitur scan struk menggunakan AI Gemini.

## 📁 Struktur Project

```
iseng_aja/
├── admin/                    # Admin Panel
│   ├── index.html           # Halaman login admin
│   ├── dashboard.html       # Halaman dashboard
│   ├── admin.js             # Logic JavaScript
│   ├── admin.css            # Styling
│   └── README.md            # Dokumentasi admin panel
├── supabase/
│   ├── functions/
│   │   └── classify-expense/ # Function AI untuk scan struk
│   │       └── index.ts
│   └── migrations/
│       └── admin-setup.sql  # SQL setup untuk admin panel
├── app.js                    # Logic utama aplikasi
├── index.html                # Halaman utama
├── style.css                 # Styling utama
├── supabase-config.js        # Konfigurasi Supabase
└── .env.example              # Template environment variables
```

## 🚀 Setup Admin Panel (Langkah demi Langkah)

### Step 1: Setup Database di Supabase

1. Buka [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Pilih project Anda
3. Klik **SQL Editor** → **New Query**
4. Copy-paste isi file `supabase/migrations/admin-setup.sql`
5. Klik **RUN**

### Step 2: Tambahkan Diri Anda sebagai Admin

1. Buka **Supabase Dashboard > Authentication > Users**
2. Klik user Anda, copy **ID**-nya
3. Jalankan SQL ini (ganti `USER_ID_ANDA`):

```sql
insert into public.admins (id, username, email, is_superadmin)
values (
  'USER_ID_ANDA_DISINI',  -- GANTI DENGAN USER_ID ANDA
  'admin_anggun',
  'admin@example.com',
  true
);
```

### Step 3: Isi Gemini API Key

Buka `admin/admin.js`, cari baris:

```javascript
const GEMINI_KEY = 'YOUR_GEMINI_API_KEY';
```

Ganti dengan key asli Anda (dapatkan di: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey))

**⚠️ PENTING:** Jangan push key asli ke GitHub!

### Step 4: Ganti Username & Password Admin

Di `admin/admin.js`, cari:

```javascript
const ADMIN_CREDENTIALS = {
  username: 'admin_anggun',
  password: 'AnggunGarden2026!@#',  // GANTI INI!
};
```

### Step 5: Push ke GitHub

```bash
git add .
git commit -m "Add admin panel setup"
git push origin main
```

### Step 6: Akses Admin Panel

Buka: `https://dio-stack.github.io/laporan-pengeluaran-uang/admin/index.html`

Login dengan username & password yang sudah Anda set.

## 🔑 Environment Variables

Lihat file `.env.example` untuk daftar environment variables yang diperlukan.

## 📊 Fitur Admin Panel

1. **Dashboard** — Statistik kuota AI & data pengeluaran user
2. **AI Quota Monitoring** — Tracking token Gemini yang terpakai
3. **Data Export** — (akan datang)

## 🛡️ Keamanan

- Login admin terpisah dari auth user biasa
- Session disimpan di localStorage (7 hari)
- RLS Policy di Supabase membatasi akses data
- API key tidak di-hardcode di file yang di-deploy

## 📝 Changelog

- **v1.0.0** (2026-11-03) — Initial admin panel release
