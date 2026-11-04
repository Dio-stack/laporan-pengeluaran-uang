// @ts-ignore: Supabase Edge Functions resolve HTTPS imports through the Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedCategories = ['makanan', 'transport', 'hiburan', 'belanja', 'kesehatan', 'skincare', 'lainnya'];

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg', customApiKey = '' } = await request.json();
    const image = String(imageBase64 || '').trim();
    if (!image) throw new Error('Foto struk belum dikirim.');

    // 1. Cek kunci Gemini resmi (Google AI Studio) terlebih dahulu
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
    const apinexKey = Deno.env.get('APINEX_API_KEY');

    if (!geminiKey && !apinexKey) {
      throw new Error('Secret GEMINI_API_KEY (atau APINEX_API_KEY) belum dikonfigurasi di Supabase.');
    }

    let parsed: any = null;
    let usedModel: string | null = null;

    // A. Coba Google Gemini API Resmi terlebih dahulu jika kuncinya ada
    if (geminiKey) {
      const configuredModel = Deno.env.get('GEMINI_MODEL');
      const candidateModels = Array.from(new Set([
        configuredModel,
        'gemini-3.8-flash',
        'gemini-2.5-flash',
        'gemini-1.5-flash',
        'gemini-2.5-pro',
        'gemini-1.5-pro'
      ].filter(Boolean))) as string[];

      const promptText = 'Baca foto struk secara langsung. Ekstrak tanggal format YYYY-MM-DD, nama toko/transaksi, nominal total angka tanpa Rp, kategori salah satu: makanan, transport, hiburan, belanja, kesehatan, skincare, lainnya, dan seluruh teks penting yang terbaca pada struk. Produk skincare atau makeup = skincare. Toko seperti Indomaret, Alfamart, supermarket, minimarket = belanja. Jawab JSON hanya dengan keys date, name, amount, category, rawText.';

      let lastGeminiError = '';
      for (const modelName of candidateModels) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;
        try {
          const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: promptText }],
              },
              contents: [
                {
                  parts: [
                    { text: 'Analisis struk pada gambar ini.' },
                    {
                      inlineData: {
                        mimeType,
                        data: image,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
              },
            }),
          });

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const rawContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            parsed = JSON.parse(rawContent);
            usedModel = modelName;
            break; // Berhasil!
          } else {
            const errorText = await geminiRes.text();
            lastGeminiError = `Google Gemini (${geminiRes.status}) pada ${modelName}: ${errorText.slice(0, 200)}`;
            console.warn(`Model ${modelName} gagal (${geminiRes.status}), mencoba model berikutnya...`);
            continue; // Coba model berikutnya jika 503, 404, 429, dll.
          }
        } catch (fetchErr: any) {
          lastGeminiError = fetchErr.message || String(fetchErr);
          console.warn(`Fetch error pada ${modelName}:`, lastGeminiError);
          continue;
        }
      }

      if (!parsed && !apinexKey) {
        throw new Error(lastGeminiError || 'Semua model Google Gemini yang dicoba sedang mengalami gangguan server (503). Coba beberapa saat lagi.');
      }
    }

    // B. Fallback ke Apinex jika Gemini belum berhasil atau belum disetel
    if (!parsed && apinexKey) {
      console.warn('Gemini tidak berhasil atau sedang high demand, beralih ke fallback Apinex...');
      const apiUrl = Deno.env.get('APINEX_API_URL') || 'https://api.apinex.bond/v1/chat/completions';
      const model = Deno.env.get('APINEX_MODEL') || 'free/gemini-3.8-flash';
      usedModel = model;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apinexKey,
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
              content: 'Baca foto struk secara langsung. Ekstrak tanggal format YYYY-MM-DD, nama toko/transaksi, nominal total angka tanpa Rp, kategori salah satu: makanan, transport, hiburan, belanja, kesehatan, skincare, lainnya, dan seluruh teks penting yang terbaca pada struk. Produk skincare atau makeup = skincare. Toko seperti Indomaret, Alfamart, supermarket, minimarket = belanja. Jawab JSON hanya dengan keys date, name, amount, category, rawText.',
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

      if (!response.ok) {
        const providerBody = await response.text();
        if (response.status === 402) {
          const providerMessage = providerBody.slice(0, 600);
          return new Response(JSON.stringify({
            error: 'Kuota AI gratis Apinex sedang tidak tersedia. Gunakan Google Gemini API resmi atau lakukan check-in Apinex.',
            providerStatus: 402,
            providerMessage,
          }), {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
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
      const messageContent = aiResponse.choices?.[0]?.message?.content || '{}';
      const content = Array.isArray(messageContent)
        ? messageContent.map(part => part.text || '').join('\n')
        : String(messageContent);
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      }
    }

    if (!parsed) {
      throw new Error('Hasil ekstraksi struk kosong.');
    }

    const category = String(parsed.category || 'lainnya').toLowerCase().trim();
    const finalCategory = allowedCategories.includes(category) ? category : 'lainnya';
    const amount = Number(String(parsed.amount || 0).replace(/[^0-9]/g, ''));

    // Log AI usage ke database (untuk monitoring quota di admin panel)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const authHeader = request.headers.get('authorization');
      const token = authHeader?.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);

      if (user) {
        // Estimasi token: 1 token ≈ 3-4 karakter (Indonesia/Inggris)
        const rawText = String(parsed.rawText || '');
        const estimatedTokens = Math.ceil(rawText.length / 3);

        await supabase.from('ai_usage_logs').insert({
          user_id: user.id,
          request_date: new Date().toISOString().split('T')[0],
          tokens_used: estimatedTokens,
          model_used: usedModel || 'unknown',
          status: 'success',
          error_message: null,
        });
      }
    } catch (logErr) {
      // Jangan throw error, biar request tetap berhasil
      console.error('Failed to log AI usage:', logErr);
    }

    return new Response(JSON.stringify({
      date: parsed.date || '',
      name: String(parsed.name || '').slice(0, 60),
      amount,
      category: finalCategory,
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
