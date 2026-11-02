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
    const { imageBase64, mimeType = 'image/jpeg', customApiKey = '' } = await request.json();
    const image = String(imageBase64 || '').trim();
    if (!image) throw new Error('Foto struk belum dikirim.');

    // 1. Cek kunci Gemini resmi (Google AI Studio) terlebih dahulu
    const geminiKey = customApiKey || Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
    const apinexKey = Deno.env.get('APINEX_API_KEY');

    if (!geminiKey && !apinexKey) {
      throw new Error('Secret GEMINI_API_KEY (atau APINEX_API_KEY) belum dikonfigurasi di Supabase.');
    }

    let parsed: any = null;

    // A. Gunakan Google Gemini API Resmi jika tersedia
    if (geminiKey) {
      const geminiModel = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
      const promptText = 'Baca foto struk secara langsung. Ekstrak tanggal format YYYY-MM-DD, nama toko/transaksi, nominal total angka tanpa Rp, kategori salah satu: makanan, transport, hiburan, belanja, kesehatan, lainnya, dan seluruh teks penting yang terbaca pada struk. rawText wajib berisi teks hasil bacaan, bukan ringkasan. Toko seperti Indomaret, Alfamart, supermarket, minimarket = belanja. Jawab JSON hanya dengan keys date, name, amount, category, rawText.';

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
      
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

      if (!geminiRes.ok) {
        const errorText = await geminiRes.text();
        // Jika model 2.5-flash belum tersedia, coba fallback ke 1.5-flash
        if (geminiRes.status === 404 && geminiModel !== 'gemini-1.5-flash') {
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
          const fallbackRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: promptText }] },
              contents: [{ parts: [{ text: 'Analisis struk ini.' }, { inlineData: { mimeType, data: image } }] }],
              generationConfig: { temperature: 0, responseMimeType: 'application/json' },
            }),
          });
          if (fallbackRes.ok) {
            const fbData = await fallbackRes.json();
            const rawContent = fbData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            parsed = JSON.parse(rawContent);
          } else {
            throw new Error(`Google Gemini API error (${geminiRes.status}): ${errorText.slice(0, 300)}`);
          }
        } else {
          throw new Error(`Google Gemini API error (${geminiRes.status}): ${errorText.slice(0, 300)}`);
        }
      } else {
        const geminiData = await geminiRes.json();
        const rawContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        parsed = JSON.parse(rawContent);
      }
    } 
    // B. Fallback ke Apinex jika Gemini API key belum ada
    else if (apinexKey) {
      const apiUrl = Deno.env.get('APINEX_API_URL') || 'https://api.apinex.bond/v1/chat/completions';
      const model = Deno.env.get('APINEX_MODEL') || 'free/gemini-3.8-flash';
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
              content: 'Baca foto struk secara langsung. Ekstrak tanggal format YYYY-MM-DD, nama toko/transaksi, nominal total angka tanpa Rp, kategori salah satu: makanan, transport, hiburan, belanja, kesehatan, lainnya, dan seluruh teks penting yang terbaca pada struk. rawText wajib berisi teks hasil bacaan, bukan ringkasan. Toko seperti Indomaret, Alfamart, supermarket, minimarket = belanja. Jawab JSON hanya dengan keys date, name, amount, category, rawText.',
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
