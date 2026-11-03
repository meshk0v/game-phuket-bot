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

const app = (startapp) => ({ url: startapp ? `${WEBAPP_URL}/?v=1#${startapp}` : WEBAPP_URL });
const kb = (rows) => ({ inline_keyboard: rows });
const back = [{ text: 'Вернуться в главное меню', callback_data: 'menu' }];

const EVENTS = {
  wed: { t: '🔥 СР-Мафия Вичит 🥷 🔥', d: 'Мафия - это место, где мы кричим, смеёмся и избавляемся от стресса. Вечер заряжен на эмоции. Все что вам осталось сделать, это занять место за игровым столом, мы вас уже ждём.', when: 'Каждую среду в 19:00', where: 'Beerfest Brewery', price: '600 бат', dur: 'до 4-х часов' },
  thu: { t: '🔥 ЧТ - Community day 👥 🔥', d: 'Формат бесплатных встреч для нашего комьюнити. Совместные походы в сауну, просмотры фильмов и многое другое.', when: 'Каждый четверг', where: 'Каждую неделю меняется, уточнять в чате', price: '0 бат', dur: 'до 3-х часов' },
  fri: { t: '🔥 ПТ-Мафия на Банг-Тао 🥷 🔥', d: 'Мафия по пятницам заряжает лучше, чем поход на Бангла-роуд.', when: 'Каждую пятницу в 19:00', where: 'Shishka UMAY, Банг-Тао', price: 'уточняйте', dur: 'до 4-х часов' },
  sat: { t: '🔥 СБ-Мафия на Раваи 🥷 🔥', d: 'Та самая равайская Мафия с криками и смехом.', when: 'Каждую субботу в 19:00', where: 'Boss Level, Равай', price: 'уточняйте', dur: 'до 4-х часов' },
  sun: { t: '🔥 ВС-Мафия на Банг-Тао 🥷 🔥', d: 'На этой Мафии собираются самые важные люди острова.', when: 'Каждое воскресенье в 19:00', where: 'LAVA Restobar, Банг-Тао', price: 'уточняйте', dur: 'до 4-х часов' },
};
const eventText = (e) => `${e.t}\n${e.d}\n\n📅 <b>Когда?</b>\n${e.when}\n<b>Где?</b>\n${e.where}\n\n💰 <b>Стоимость участия:</b> ${e.price}\n⏳ <b>Продолжительность:</b> ${e.dur}\n\n🚀 <b>Как попасть?</b>\nНажимайте на кнопку «Записаться на мероприятие»`;

const MENU_TEXT = `Какое мероприятие вас интересует?\n\n<b>СР-Мафия Вичит</b> 🥷\nУвлекательная Мафия посредине недели и посредине острова — отличное сочетание.\n\n<b>ЧТ - Community day</b> 👥\nКаждую неделю бесплатные встречи с активностями для нашего комьюнити\n\n<b>ПТ-Мафия на Банг-Тао</b> 🥷\nМафия по пятницам заряжает лучше, чем поход на Бангла-роуд.\n\n<b>СБ-Мафия на Раваи</b> 🥷\nТа самая равайская Мафия с криками и смехом\n\n<b>ВС-Мафия на Банг-Тао</b> 🥷\nНа этой Мафии собираются самые важные люди острова.`;
const MENU_KB = () => kb([
  [{ text: '🚀 Открыть мини-апп', web_app: app() }],
  [{ text: 'СР-Мафия Вичит 🥷', callback_data: 'ev:wed' }],
  [{ text: 'ЧТ - Community day 👥', callback_data: 'ev:thu' }],
  [{ text: 'ПТ-Мафия на Банг-Тао 🥷', callback_data: 'ev:fri' }],
  [{ text: 'СБ-Мафия на Раваи 🥷', callback_data: 'ev:sat' }],
  [{ text: 'ВС-Мафия на Банг-Тао 🥷', callback_data: 'ev:sun' }],
  [{ text: 'Заказать Мафию с ведущим', web_app: app('private-mafia') }],
  [{ text: 'Заказать игры с ведущим на мероприятие', web_app: app('private-games') }],
  [{ text: 'Сотрудничество с Game Phuket', web_app: app('coop') }],
  [{ text: 'Задать вопрос', web_app: app('ask') }],
]);

async function onMessage(m) {
  const chat = m.chat.id;
  if (m.web_app_data) { // данные из tg.sendData() (работает при запуске с keyboard-кнопки)
    return api('sendMessage', { chat_id: chat, text: `Заявка получена ✅\n<code>${m.web_app_data.data}</code>`, parse_mode: 'HTML' });
  }
  if ((m.text || '').startsWith('/start')) {
    return api('sendMessage', {
      chat_id: chat, text: 'Приветствую!\n<b>Выбери, где ты сейчас:</b>', parse_mode: 'HTML',
      reply_markup: kb([[{ text: 'Пхукет', callback_data: 'menu' }], [{ text: 'Санкт-Петербург', callback_data: 'spb' }]]),
    });
  }
}

async function onCallback(q) {
  const chat = q.message.chat.id, [a, b] = q.data.split(':');
  api('answerCallbackQuery', { callback_query_id: q.id });
  const send = (text, reply_markup) => api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup });
  if (a === 'menu') return send(MENU_TEXT, MENU_KB());
  if (a === 'spb') return send('В Санкт-Петербурге скоро будет! Следите за новостями в Instagram: @game.phuket', kb([back]));
  if (a === 'ev') return send(eventText(EVENTS[b]), kb([
    [{ text: 'Записаться на мероприятие', web_app: app(`event-${b}`) }],
    [{ text: 'Задать вопрос', web_app: app('ask') }],
    [{ text: 'Вернуться назад', callback_data: 'menu' }],
  ]));
}

async function startBot() {
  await api('deleteWebhook');
  if (WEBAPP_URL) await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Game Phuket', web_app: { url: WEBAPP_URL } } });
  await api('setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }] });
  console.log('Bot started (long polling)');
  let offset = 0;
  for (;;) {
    const ups = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }).catch(() => null);
    if (!ups) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    for (const u of ups) {
      offset = u.update_id + 1;
      (u.message ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : null)?.catch(console.error);
    }
  }
}
