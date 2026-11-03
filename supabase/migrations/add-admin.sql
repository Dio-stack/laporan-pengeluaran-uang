-- =====================================================
-- TAMBAHKAN ADMIN (Jalankan SETELAH admin-setup.sql)
-- =====================================================
-- 1. Buka: Supabase Dashboard > Authentication > Users
-- 2. Klik user Anda, copy "ID"-nya (format UUID)
-- 3. Ganti 'USER_ID_ANDA_DISINI' di bawah dengan ID tersebut
-- 4. Jalankan script ini
-- =====================================================

-- GANTI USER_ID_ANDA_DISINI DENGAN ID ANDA!
insert into public.admins (id, username, email, is_superadmin)
values (
  '99877691-e9ae-48ad-896d-43929ff284f0',  -- ⚠️ GANTI INI DENGAN USER_ID ANDA ⚠️
  'dio',
  'dio@dompetku.app',
  true
);

-- Verifikasi
select * from public.admins;
