declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedCategories = ['makanan', 'transport', 'hiburan', 'belanja', 'kesehatan', 'lainnya'];

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('APINEX_API_KEY');
    if (!apiKey) throw new Error('Secret APINEX_API_KEY belum dikonfigurasi di Supabase.');

    const { receiptText } = await request.json();
    const text = String(receiptText || '').trim().slice(0, 8000);
    if (!text) throw new Error('Teks struk kosong.');

    const apiUrl = Deno.env.get('APINEX_API_URL') || 'https://api.apinex.bond/v1/chat/completions';
    const model = Deno.env.get('APINEX_MODEL') || 'free/gemini-3.8-flash';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Klasifikasikan transaksi dari teks struk ke salah satu category. Aturan: Indomaret, Alfamart, supermarket, minimarket, toko kelontong, atau toko umum = belanja; cafe, restoran, warung, kopi, makanan = makanan; apotek atau klinik = kesehatan; bensin, parkir, bus, kereta, taksi = transport; bioskop, game, tiket hiburan = hiburan. Hanya jawab JSON persis: {"category":"makanan|transport|hiburan|belanja|kesehatan|lainnya"}.',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      const providerBody = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Apinex menolak API key (${response.status}). Periksa secret APINEX_API_KEY.`);
      }
      throw new Error(`Apinex mengembalikan status ${response.status}${providerBody ? `: ${providerBody.slice(0, 300)}` : ''}`);
    }

    const providerText = await response.text();
    let aiResponse: any;
    try {
      aiResponse = JSON.parse(providerText);
    } catch {
      throw new Error(`Apinex mengembalikan respons non-JSON: ${providerText.slice(0, 300)}`);
    }
    const content = aiResponse.choices?.[0]?.message?.content || '{}';
    let category = '';
    try {
      category = JSON.parse(content).category;
    } catch {
      const match = content.match(/"category"\s*:\s*"([a-z]+)"/i);
      category = match?.[1] || '';
    }
    category = String(category).toLowerCase().trim();

    if (!allowedCategories.includes(category)) {
      throw new Error(`Kategori AI tidak valid: ${category || '(kosong)'}`);
    }

    return new Response(JSON.stringify({ category }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Klasifikasi AI gagal.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
