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
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));

/* ---------- Валидация initData (Telegram Mini Apps API) ---------- */
function validateInitData(initData, token) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > 86400) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}
const adminOf = (req) => {
  const u = validateInitData(req.headers['x-init-data'] || '', BOT_TOKEN);
  return u && ADMIN_IDS.has(String(u.id)) ? u : null;
};

/* ---------- Конфиг: города и афиша (data/config.json) ---------- */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CFG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'default-config.json'), 'utf8'));
let state;
try { state = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { state = { rev: 1, config: DEFAULT_CFG }; }
function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(CFG_FILE + '.tmp', CFG_FILE);
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const idOk = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
function sanitize(c) {
  const bad = (m) => { throw new Error(m); };
  if (!c || !Array.isArray(c.cities) || !Array.isArray(c.events)) bad('Неверный формат');
  if (c.cities.length > 50 || c.events.length > 500) bad('Слишком много записей');
  const cityIds = new Set();
  const cities = c.cities.map((x) => {
    if (!idOk(x?.id) || cityIds.has(x.id)) bad('Неверный id города');
    cityIds.add(x.id);
    const name = str(x.name, 60); if (!name) bad('У города нет названия');
    const tz = Number(x.tz);
    const ab = x.about || {}, url = (v) => (/^https:\/\/[^\s<>"']+$/i.test(String(v || '').trim()) ? String(v).trim().slice(0, 200) : '');
    const about = { lead: str(ab.lead, 160), members: str(ab.members, 20), tg: url(ab.tg), ig: url(ab.ig), wa: url(ab.wa), site: url(ab.site) };
    return { id: x.id, name, status: x.status === 'active' ? 'active' : 'soon', sub: str(x.sub, 80), tz: Number.isFinite(tz) && tz >= -12 && tz <= 14 ? tz : 0, about };
  });
  const evIds = new Set();
  const events = c.events.map((e) => {
    if (!idOk(e?.id) || evIds.has(e.id)) bad('Неверный id мероприятия');
    evIds.add(e.id);
    if (!cityIds.has(e.city)) bad('Мероприятие без города');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) bad('Неверное время');
    const o = { id: e.id, city: e.city, repeat: e.repeat === 'once' ? 'once' : 'weekly', time: e.time, type: str(e.type, 40), title: str(e.title, 80),
      place: str(e.place, 100), area: str(e.area, 80), dur: str(e.dur, 120), desc: str(e.desc, 1000), blue: !!e.blue, active: e.active !== false, price: null };
    if (!o.title) bad('У мероприятия нет названия');
    if (o.repeat === 'once') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) bad('Неверная дата');
      o.date = e.date;
    } else {
      const d = Number(e.dow); if (!Number.isInteger(d) || d < 0 || d > 6) bad('Неверный день недели');
      o.dow = d;
    }
    if (e.price !== null && e.price !== '' && e.price !== undefined) {
      const p = Number(e.price); if (!Number.isInteger(p) || p < 0 || p > 1e6) bad('Неверная цена');
      o.price = p;
    }
    return o;
  });
  return { cities, events };
}

/* ---------- HTTP: статика + API ---------- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const ORIGINS = new Set(['https://meshk0v.github.io', ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
try { if (WEBAPP_URL) ORIGINS.add(new URL(WEBAPP_URL).origin); } catch {}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 300_000) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > limit) { reject(new Error('Слишком большой запрос')); req.destroy(); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  if (origin && ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Init-Data');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname.startsWith('/api/')) {
    try {
      if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, state);
      if (req.method === 'POST' && url.pathname === '/api/me') return send(res, 200, { isAdmin: !!adminOf(req) });
      if (req.method === 'PUT' && url.pathname === '/api/admin/config') {
        if (!adminOf(req)) return send(res, 403, { error: 'Нет доступа' });
        const body = JSON.parse(await readBody(req) || '{}');
        if (body.rev !== state.rev) return send(res, 409, { error: 'Данные уже изменены', ...state });
        let config;
        try { config = sanitize(body.config); } catch (e) { return send(res, 400, { error: e.message }); }
        state = { rev: state.rev + 1, config };
        persist();
        return send(res, 200, state);
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) { return send(res, 400, { error: e.message || 'Bad request' }); }
  }

  let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const root = path.join(__dirname, 'docs');
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Mini App: http://localhost:${PORT}  (админов: ${ADMIN_IDS.size})`));

/* ---------- Bot ---------- */
if (!BOT_TOKEN) { console.log('BOT_TOKEN не задан — запущен только веб-сервер мини-аппа.'); }
else if (process.env.LOCAL_BOT === '1') startBot();
else console.log('Бот работает через Cloudflare Worker (вебхук). Локальный запуск бота: LOCAL_BOT=1 (отключит вебхук).');

async function api(method, payload = {}) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!j.ok) console.error(method, j.description);
  return j.result;
}

async function onMessage(m) {
  if ((m.text || '').startsWith('/id')) {
    return api('sendMessage', { chat_id: m.chat.id, ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}), text: m.chat.type === 'private' ? `Ваш Telegram ID: <code>${m.from.id}</code>\nВпишите его в ADMIN_IDS в .env, чтобы получить доступ к админке.` : `ID этого чата: <code>${m.chat.id}</code>${m.message_thread_id ? `\nТема: <code>${m.message_thread_id}</code>` : ''}`, parse_mode: 'HTML' });
  }
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
  await api('setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }, { command: 'id', description: 'Узнать свой Telegram ID' }] });
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
