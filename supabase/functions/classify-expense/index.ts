const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedCategories = ['makanan', 'transport', 'hiburan', 'belanja', 'kesehatan', 'lainnya'];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('AI_API_KEY');
    if (!apiKey) throw new Error('Secret AI_API_KEY belum dikonfigurasi di Supabase.');

    const { receiptText } = await request.json();
    const text = String(receiptText || '').trim().slice(0, 8000);
    if (!text) throw new Error('Teks struk kosong.');

    const apiUrl = Deno.env.get('AI_API_URL') || 'https://api.groq.com/openai/v1/chat/completions';
    const model = Deno.env.get('AI_MODEL') || 'llama-3.1-8b-instant';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Klasifikasikan transaksi dari teks struk. Pilih hanya salah satu category: makanan, transport, hiburan, belanja, kesehatan, lainnya. Jawab JSON persis: {"category":"..."}',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API mengembalikan status ${response.status}`);
    }

    const aiResponse = await response.json();
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
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Klasifikasi AI gagal.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
