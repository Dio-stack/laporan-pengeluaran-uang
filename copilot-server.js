import http from 'node:http';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

const port = Number(process.env.COPILOT_SERVER_PORT || 8787);
const allowedCategories = new Set(['makanan', 'transport', 'hiburan', 'belanja', 'kesehatan', 'lainnya']);
const client = new CopilotClient();
await client.start();

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  response.end(JSON.stringify(body));
}

async function classify(receiptText) {
  const session = await client.createSession({
    model: 'gpt-5',
    onPermissionRequest: approveAll,
  });

  try {
    const prompt = `Klasifikasikan teks struk berikut ke salah satu kategori: makanan, transport, hiburan, belanja, kesehatan, lainnya.\nAturan: Indomaret, Alfamart, supermarket, minimarket, toko kelontong, atau toko umum = belanja. Cafe, restoran, warung, kopi = makanan. Apotek atau klinik = kesehatan. Bensin, parkir, transport umum = transport. Bioskop atau tiket hiburan = hiburan.\nJawab hanya satu kata kategori, tanpa tanda baca atau penjelasan.\nTeks struk:\n${receiptText.slice(0, 8000)}`;
    const result = await session.sendAndWait({ prompt }, 30000);
    const category = String(result?.data?.content || '').toLowerCase().trim().replace(/[^a-z]/g, '');
    if (!allowedCategories.has(category)) throw new Error(`Copilot menghasilkan kategori tidak valid: ${category || '(kosong)'}`);
    return category;
  } finally {
    await session.disconnect();
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method !== 'POST' || request.url !== '/classify-expense') {
    return sendJson(response, 404, { error: 'Endpoint tidak ditemukan.' });
  }

  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const receiptText = String(body.receiptText || '').trim();
    if (!receiptText) return sendJson(response, 400, { error: 'Teks struk kosong.' });
    const category = await classify(receiptText);
    sendJson(response, 200, { category });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Klasifikasi Copilot gagal.';
    sendJson(response, 500, { error: message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Copilot classification server running at http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.stop().catch(() => {});
    server.close(() => process.exit(0));
  });
}
