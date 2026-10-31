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

    const { imageBase64, mimeType = 'image/jpeg' } = await request.json();
    const image = String(imageBase64 || '').trim();
    if (!image) throw new Error('Foto struk belum dikirim.');

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
            content: 'Baca foto struk. Ekstrak tanggal format YYYY-MM-DD, nama toko/transaksi, nominal total angka tanpa Rp, kategori salah satu: makanan, transport, hiburan, belanja, kesehatan, lainnya, dan teks singkat terbaca. Toko seperti Indomaret, Alfamart, supermarket, minimarket = belanja. Jawab JSON hanya dengan keys date, name, amount, category, rawText.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analisis struk pada gambar ini.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
            ],
          },
        ],
      }),
    });

    console.log(response);

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
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }
    const category = String(parsed.category || 'lainnya').toLowerCase().trim();
    if (!allowedCategories.includes(category)) {
      throw new Error(`Kategori AI tidak valid: ${category || '(kosong)'}`);
    }
    const amount = Number(String(parsed.amount || 0).replace(/[^0-9]/g, ''));
    return new Response(JSON.stringify({
      date: parsed.date || '',
      name: String(parsed.name || '').slice(0, 60),
      amount,
      category,
      rawText: String(parsed.rawText || ''),
    }), {
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
