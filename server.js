// Сервер мини-аппа + Telegram-бот (long polling, без внешних зависимостей).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync('.env')) {
  for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { BOT_TOKEN, WEBAPP_URL, PORT = 3000 } = process.env;

/* ---------- Валидация initData (Telegram Mini Apps API) ---------- */
function validateInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc !== hash) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > 86400) return null;
  return JSON.parse(params.get('user') || 'null');
}

/* ---------- HTTP: статика + API ---------- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/auth') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const user = BOT_TOKEN && validateInitData(body, BOT_TOKEN);
      res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user ? { ok: true, user } : { ok: false }));
    });
    return;
  }
  let file = path.join(__dirname, 'docs', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(__dirname, 'docs')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Mini App: http://localhost:${PORT}`));

/* ---------- Bot ---------- */
if (!BOT_TOKEN) { console.log('BOT_TOKEN не задан — запущен только веб-сервер мини-аппа.'); }
else startBot();

async function api(method, payload = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) console.error(method, j.description);
  return j.result;
}

async function onMessage(m) {
  if (!(m.text || '').startsWith('/start')) return;
  return api('sendMessage', {
    chat_id: m.chat.id, text: 'Приветствую! 🎭\n<b>Game Phuket</b> — мафия-клуб на Пхукете.\n\nАфиша, запись на игры, частные мероприятия и сотрудничество — всё в приложении 👇',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Game Phuket', web_app: { url: WEBAPP_URL } }]] },
  });
}

async function startBot() {
  await api('deleteWebhook');
  if (WEBAPP_URL) await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Game Phuket', web_app: { url: WEBAPP_URL } } });
  await api('setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }] });
  console.log('Bot started (long polling)');
  let offset = 0;
  for (;;) {
    const ups = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }).catch(() => null);
    if (!ups) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    for (const u of ups) {
      offset = u.update_id + 1;
      if (u.message) onMessage(u.message).catch(console.error);
    }
  }
}
