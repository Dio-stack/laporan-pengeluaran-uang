declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// @ts-ignore: Supabase Edge Functions resolve HTTPS imports through the Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) belum siap.');
    }

    const { username, newPassword } = await request.json();
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(newPassword || '');

    if (cleanUsername.length < 3 || cleanPassword.length < 6) {
      throw new Error('Username minimal 3 karakter dan password minimal 6 karakter.');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const targetEmail = `${cleanUsername}@dompetku.app`;

    // Cari user di semua halaman agar tidak gagal ketika akun berada setelah halaman pertama.
    let targetUser: { id: string } | undefined;
    let page = 1;

    while (!targetUser) {
      const { data, error: userError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (userError) throw userError;

      targetUser = data.users.find(
        (user: { email?: string | null }) => (user.email || '').toLowerCase() === targetEmail,
      );

      if (data.users.length < 1000) break;
      page += 1;
    }
    if (!targetUser) {
      throw new Error(`Akun dengan username "${cleanUsername}" tidak ditemukan di database.`);
    }

    // Perbarui password user di Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
      password: cleanPassword,
    });

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, message: 'Password Supabase berhasil diperbarui.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal reset password.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
