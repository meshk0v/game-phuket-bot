// Cloudflare Worker: API для мини-аппа Game Phuket (города и афиша).
// Хранилище — Workers KV (ключ "state"). Тот же API, что и в server.js.
import DEFAULT_CFG from '../docs/default-config.json';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hmac = async (key, data) => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
};

// Проверка подписи Telegram initData
async function validateInitData(initData, token) {
  if (!initData || !token) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  p.delete('hash');
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), token);
  const calc = hex(await hmac(secret, dcs));
  let diff = 0; for (let i = 0; i < 64; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i); // сравнение за постоянное время
  if (diff) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch { return null; }
}
async function isAdmin(req, env) {
  const u = await validateInitData(req.headers.get('X-Init-Data') || '', env.BOT_TOKEN);
  const ids = (env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !!u && ids.includes(String(u.id));
}

// Проверка и очистка конфига (как в server.js)
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
    return { id: x.id, name, status: x.status === 'active' ? 'active' : 'soon', sub: str(x.sub, 80), tz: Number.isFinite(tz) && tz >= -12 && tz <= 14 ? tz : 0 };
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

/* ---------- Запись на игру и оплата ---------- */
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const h = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const TG = (env) => env.TELEGRAM_API || 'https://api.telegram.org';
async function tgJson(env, method, body) {
  const form = body instanceof FormData;
  try {
    const r = await fetch(`${TG(env)}/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', headers: form ? undefined : { 'Content-Type': 'application/json' }, body: form ? body : JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false, description: 'network error' }; }
}
const tgCall = async (env, method, body) => !!(await tgJson(env, method, body)).ok;
const managers = (env) => (env.MANAGER_IDS || env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
const profileUrl = (u) => (u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.id}`);
// «Имя» кликабельно по ID даже без @username
const who = (u) => `👤 <a href="tg://user?id=${u.id}">${h(fullName(u))}</a>${u.username ? ' · @' + h(u.username) : ''}\n🆔 <code>${u.id}</code>`;
const profileRow = (u) => [{ text: '👤 Профиль', url: profileUrl(u) }];
const pad2 = (n) => String(n).padStart(2, '0');
const tgTime = (unix, fmt, label) => `<tg-time unix="${unix}" format="${fmt}">${h(label)}</tg-time>`;
const quote = (s) => `<blockquote${s.length > 300 ? ' expandable' : ''}>${h(s)}</blockquote>`;

// Отправка в одну точку: (chat, thread) — текст или файл с подписью, с кнопками
async function post(env, chat, thread, text, file, markup) {
  const base = { chat_id: chat, parse_mode: 'HTML', ...(thread ? { message_thread_id: thread } : {}) };
  if (!file) return tgJson(env, 'sendMessage', { ...base, text, ...(markup ? { reply_markup: markup } : {}) });
  const isPdf = file.type === 'application/pdf', fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, caption: text })) fd.append(k, String(v));
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  fd.append(isPdf ? 'document' : 'photo', file, OK_TYPES[file.type]);
  return tgJson(env, isPdf ? 'sendDocument' : 'sendPhoto', fd);
}
// На каждого участника — своя тема в чате менеджеров (id темы хранится в KV)
async function sendToChat(env, user, text, file, markup) {
  const chat = env.MANAGER_CHAT_ID;
  if (!chat) return false;
  const key = `topic:${chat}:${user.id}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let thread = attempt === 0 ? Number(await env.CONFIG.get(key)) || null : null, fresh = false;
    if (!thread) {
      const t = await tgJson(env, 'createForumTopic', { chat_id: chat, name: (fullName(user) + (user.username ? ' @' + user.username : '')).slice(0, 128) });
      if (t.ok) { thread = t.result.message_thread_id; await env.CONFIG.put(key, String(thread)); fresh = true; }
      else if (!/not a forum/i.test(t.description || '')) return false; // нет прав на создание тем и т.п. — запасной путь
      // иначе чат без тем: пишем в общий поток
    }
    if (fresh) await post(env, chat, thread, `🆕 <b>Новый участник</b>\n\n${who(user)}`, null, { inline_keyboard: [profileRow(user)] });
    const r = await post(env, chat, thread, text, file, markup);
    if (r.ok) return true;
    if (thread && attempt === 0 && /thread not found|TOPIC_DELETED|topic.*(closed|deleted)/i.test(r.description || '')) { await env.CONFIG.delete(key); continue; } // тему удалили — создадим заново
    return false;
  }
  return false;
}
// Основной путь — чат с темами; если не вышло — личные сообщения менеджерам
async function deliver(env, user, text, file, markup) {
  if (await sendToChat(env, user, text, file, markup)) return 1;
  let n = 0;
  for (const id of managers(env)) if ((await post(env, id, null, text, file, markup)).ok) n++;
  return n;
}
async function rateOk(env, user, kind, max) {
  const key = `rl:${kind}:${user.id}`, used = Number(await env.CONFIG.get(key)) || 0;
  return { ok: used < max, bump: () => env.CONFIG.put(key, String(used + 1), { expirationTtl: 3600 }) };
}
const userOf = (req, env) => validateInitData(req.headers.get('X-Init-Data') || '', env.BOT_TOKEN);
const OK_TYPES = { 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'image/webp': 'photo.webp', 'application/pdf': 'receipt.pdf' };
const METHOD_NAME = { thb: 'Тайский счёт (PromptPay)', rub: 'Российский счёт', usdt: 'Крипта (USDT TRC-20)', free: 'Бесплатно', manager: 'Нет возможности оплатить' };

async function register(req, env, send) {
  const user = await userOf(req, env);
  if (!user) return send(401, { error: 'Откройте приложение из Telegram' });
  if (Number(req.headers.get('Content-Length')) > 12e6) return send(413, { error: 'Файл слишком большой' });
  const rate = await rateOk(env, user, 'reg', 6);
  if (!rate.ok) return send(429, { error: 'Слишком много заявок, попробуйте через час' });

  const f = await req.formData();
  const state = await readState(env);
  const ev = state.config.events.find((e) => e.id === f.get('eventId') && e.active !== false);
  if (!ev) return send(400, { error: 'Мероприятие не найдено' });
  const city = state.config.cities.find((c) => c.id === ev.city);
  const date = String(f.get('date') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return send(400, { error: 'Неверная дата' });
  const n = Number(f.get('count'));
  if (!Number.isInteger(n) || n < 1 || n > 10) return send(400, { error: 'Неверное количество' });
  let method = String(f.get('method') || '');
  if (ev.price === 0) method = 'free';
  if (!['thb', 'rub', 'usdt', 'manager', 'free'].includes(method)) return send(400, { error: 'Неверный способ оплаты' });
  const pay = (await env.CONFIG.get('payments', 'json')) || {};
  let amount = '';
  if (method === 'thb') { if (!(ev.price > 0)) return send(400, { error: 'Сумма не задана' }); amount = `${ev.price * n} ฿`; }
  if (method === 'rub') { if (!pay.rub?.perPlayer) return send(400, { error: 'Способ недоступен' }); amount = `${pay.rub.perPlayer * n} ₽`; }
  if (method === 'usdt') { if (!pay.usdt?.perPlayer) return send(400, { error: 'Способ недоступен' }); amount = `${pay.usdt.perPlayer * n} USDT`; }

  const needFile = ['thb', 'rub', 'usdt'].includes(method);
  const file = f.get('receipt');
  const hasFile = file && typeof file === 'object' && file.size > 0;
  if (needFile && !hasFile) return send(400, { error: 'Прикрепите чек об оплате' });
  if (hasFile && (file.size > 8e6 || !OK_TYPES[file.type])) return send(400, { error: 'Чек: фото (JPG, PNG) или PDF до 8 МБ' });

  const d = new Date(date + 'T00:00:00Z');
  const when = `${WD_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${ev.time}`;
  const [yy, mo, dd] = date.split('-').map(Number), [hh, mi] = ev.time.split(':').map(Number);
  const unix = Math.floor((Date.UTC(yy, mo - 1, dd, hh, mi) - (city?.tz ?? 0) * 3600e3) / 1000); // начало игры по времени города
  const comment = String(f.get('comment') || '').trim().slice(0, 300);
  const head = method === 'manager' ? '⚠️ <b>Нет возможности оплатить</b> — свяжитесь с клиентом' : method === 'free' ? '🎟 <b>Новая запись</b> · бесплатно' : '🧾 <b>Новая запись + чек</b>';
  const text = [
    head, '',
    `<blockquote>🎭 <b>${h(ev.title)}</b>\n📅 ${tgTime(unix, 'wDt', when)} · ${tgTime(unix, 'r', 'скоро')}\n📍 ${h(ev.place)}${ev.area ? ', ' + h(ev.area) : ''}${city ? ' (' + h(city.name) + ')' : ''}</blockquote>`, '',
    `👥 <b>${n}</b> чел.${method === 'free' || method === 'manager' ? '' : ` · 💳 ${METHOD_NAME[method]}`}`,
    ...(amount ? [`💰 <b>${h(amount)}</b>`] : []), '',
    who(user),
    ...(comment ? ['', quote(comment)] : []),
  ].join('\n');

  // запись о заявке — для кнопки «Подтвердить» (хранится 60 дней)
  const rid = crypto.randomUUID().slice(0, 8), kind = method === 'manager' ? 'manager' : 'paid';
  await env.CONFIG.put('reg:' + rid, JSON.stringify({ uid: user.id, uname: user.username || '', html: text, file: !!hasFile, kind, title: ev.title, when, place: ev.place }), { expirationTtl: 60 * 86400 });
  const markup = { inline_keyboard: [[{ text: kind === 'manager' ? '✅ Обработано' : '✅ Подтвердить', callback_data: 'ok:' + rid, style: 'success' }], profileRow(user)] };

  const delivered = await deliver(env, user, text, hasFile ? file : null, markup);
  if (!delivered) return send(502, { error: 'Не удалось отправить заявку менеджеру. Попробуйте позже.' });
  await rate.bump();

  // подтверждение клиенту в чат с ботом (если не получится — не страшно)
  const ack = method === 'manager'
    ? `📨 Заявка отправлена. Менеджер свяжется с вами в ближайшее время.\n\n${h(ev.title)} — ${h(when)}`
    : `✅ <b>Вы записаны на игру!</b>\n\n🎭 ${h(ev.title)}\n📅 ${h(when)}\n📍 ${h(ev.place)}\n\nХорошего дня и до встречи!`;
  await tgCall(env, 'sendMessage', { chat_id: user.id, text: ack, parse_mode: 'HTML' });
  return send(200, { ok: true, kind: method === 'manager' ? 'manager' : 'paid' });
}

async function request(req, env, send) {
  const user = await userOf(req, env);
  if (!user) return send(401, { error: 'Откройте приложение из Telegram' });
  if (Number(req.headers.get('Content-Length')) > 20000) return send(413, { error: 'Слишком большой запрос' });
  const rate = await rateOk(env, user, 'req', 10);
  if (!rate.ok) return send(429, { error: 'Слишком много заявок, попробуйте через час' });
  const b = await req.json().catch(() => ({}));
  const t = (v, max) => String(v ?? '').trim().slice(0, max);
  const type = b.type, contact = t(b.contact, 100), name = t(b.name, 100), message = t(b.message, 1500);
  if (!['ask', 'coop', 'order', 'custom'].includes(type)) return send(400, { error: 'Неверный тип заявки' });
  if (!contact) return send(400, { error: 'Укажите контакт' });
  let head, lines = [];
  if (type === 'ask') { if (!message) return send(400, { error: 'Напишите вопрос' }); head = '❓ <b>Вопрос</b>'; lines = [quote(message)]; }
  if (type === 'coop') { if (!message) return send(400, { error: 'Опишите предложение' }); head = '🤝 <b>Сотрудничество</b>'; lines = [quote(message)]; }
  if (type === 'custom') {
    if (!message) return send(400, { error: 'Опишите мероприятие' });
    const guests = Math.round(Number(b.guests)), hasDate = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '');
    head = '✨ <b>Своё мероприятие</b>';
    lines = [quote(message), ...(guests >= 1 && guests <= 1000 || hasDate ? ['', `<blockquote>${[guests >= 1 && guests <= 1000 ? `👥 Гостей: <b>${guests}</b>` : '', hasDate ? `📅 Дата: <b>${h(b.date)}</b>` : ''].filter(Boolean).join('\n')}</blockquote>`] : [])];
  }
  if (type === 'order') {
    const formats = (Array.isArray(b.formats) ? b.formats : []).map((x) => t(x, 30)).filter(Boolean).slice(0, 10);
    if (!formats.length) return send(400, { error: 'Выберите хотя бы одну игру' });
    const guests = Math.min(500, Math.max(1, Math.round(Number(b.guests)) || 1));
    head = '🎉 <b>Заказ игр на мероприятие</b>';
    lines = [`<blockquote>🎮 <b>${h(formats.join(', '))}</b>\n👥 Гостей: <b>${guests}</b> · 🌐 ${b.lang === 'EN' ? 'English' : 'Русский'}${/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? `\n📅 Дата: <b>${h(b.date)}</b>` : ''}</blockquote>`, ...(message ? ['', quote(message)] : [])];
  }
  // контакт и имя из формы показываем, только если они отличаются от профиля Telegram (иначе дублируют строку ниже)
  const norm = (s) => s.replace(/^@/, '').trim().toLowerCase();
  const parts = [];
  if (!(user.username && norm(contact) === norm(user.username))) parts.push(`📞 <b>${h(contact)}</b>`);
  if (name && norm(name) !== norm(fullName(user))) parts.push(`✍️ ${h(name)}`);
  const text = [head, '', ...lines, '', ...(parts.length ? [parts.join(' · '), ''] : []), who(user)].join('\n');
  if (!(await deliver(env, user, text, null, { inline_keyboard: [profileRow(user)] }))) return send(502, { error: 'Не удалось отправить. Попробуйте позже.' });
  await rate.bump();
  const ack = { ask: '📨 Вопрос получен. Ответим в ближайшее время.', coop: '📨 Предложение получено. Менеджер свяжется с вами.', order: '📨 Заявка на мероприятие получена. Менеджер свяжется с вами в ближайшее время.', custom: '📨 Заявка на ваше мероприятие получена. Менеджер свяжется с вами в ближайшее время.' }[type];
  await tgCall(env, 'sendMessage', { chat_id: user.id, text: ack });
  return send(200, { ok: true });
}

/* ---------- Бот на вебхуке: /start, /id, кнопка «Подтвердить» ---------- */
async function canConfirm(env, q) {
  const ids = new Set([...managers(env), ...(env.ADMIN_IDS || '').split(',').map((s) => s.trim())]);
  if (ids.has(String(q.from.id))) return true;
  if (q.message?.chat?.type && q.message.chat.type !== 'private') {
    const m = await tgJson(env, 'getChatMember', { chat_id: q.message.chat.id, user_id: q.from.id });
    return !!m.ok && ['creator', 'administrator'].includes(m.result.status);
  }
  return false;
}
async function onCallback(env, q) {
  const answer = (text, alert) => tgCall(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: !!alert });
  const id = String(q.data || '').startsWith('ok:') ? q.data.slice(3) : null;
  if (!id || !q.message) return answer();
  const rec = await env.CONFIG.get('reg:' + id, 'json');
  if (!rec) return answer('Заявка устарела', true);
  if (!(await canConfirm(env, q))) return answer('Подтверждать могут только менеджеры', true);
  if (rec.by) return answer('Уже подтверждено: ' + rec.by);
  const by = fullName(q.from), now = Date.now(), unix = Math.floor(now / 1000), bk = new Date(now + 7 * 3600e3);
  rec.by = by;
  await env.CONFIG.put('reg:' + id, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
  const line = `${rec.kind === 'manager' ? '✅ <b>Обработано</b>' : '✅ <b>Подтверждено</b>'} · ${h(by)} · ${tgTime(unix, 'Dt', `${pad2(bk.getUTCDate())}.${pad2(bk.getUTCMonth() + 1)} ${pad2(bk.getUTCHours())}:${pad2(bk.getUTCMinutes())}`)}`;
  const body = { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [profileRow({ id: rec.uid, username: rec.uname })] } };
  await tgJson(env, rec.file ? 'editMessageCaption' : 'editMessageText', { ...body, ...(rec.file ? { caption: `${rec.html}\n\n${line}` } : { text: `${rec.html}\n\n${line}` }) });
  await answer(rec.kind === 'manager' ? 'Отмечено ✅' : 'Подтверждено ✅');
  if (rec.kind !== 'manager') await tgCall(env, 'sendMessage', { chat_id: rec.uid, parse_mode: 'HTML', text: `✅ <b>Запись подтверждена</b>\n\n<blockquote>🎭 <b>${h(rec.title)}</b>\n📅 ${h(rec.when)}\n📍 ${h(rec.place)}</blockquote>\n\nЖдём вас! 🎭` });
}
async function onUpdate(env, u) {
  if (u.callback_query) return onCallback(env, u.callback_query);
  const m = u.message;
  if (!m?.text) return;
  if (/^\/start(@\w+)?(\s|$)/.test(m.text) && m.chat.type === 'private') {
    return tgCall(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML',
      text: 'Приветствую! 🎭\n<b>Game Phuket</b> — мафия-клуб на Пхукете.\n\nАфиша, запись на игры, частные мероприятия и сотрудничество — всё в приложении 👇',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Game Phuket', web_app: { url: env.WEBAPP_URL } }]] } });
  }
  if (/^\/id(@\w+)?(\s|$)/.test(m.text)) {
    const text = m.chat.type === 'private' ? `Ваш Telegram ID: <code>${m.from.id}</code>` : `ID этого чата: <code>${m.chat.id}</code>${m.message_thread_id ? `\nТема: <code>${m.message_thread_id}</code>` : ''}`;
    return tgCall(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text, ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });
  }
}

const readState = async (env) => (await env.CONFIG.get('state', 'json')) || { rev: 1, config: DEFAULT_CFG };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const allowed = new Set(['https://meshk0v.github.io', ...(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
    const cors = origin && allowed.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }
      : {};
    const send = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method === 'GET' && url.pathname === '/api/config') return send(200, await readState(env));
      if (req.method === 'POST' && url.pathname === '/api/me') return send(200, { isAdmin: await isAdmin(req, env) });
      if (req.method === 'POST' && url.pathname === '/api/tg') {
        if (!env.TG_WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
        try { await onUpdate(env, await req.json()); } catch { /* Telegram не должен получать ошибку и слать повторы */ }
        return new Response('ok');
      }
      if (req.method === 'POST' && url.pathname === '/api/register') return await register(req, env, send);
      if (req.method === 'POST' && url.pathname === '/api/request') return await request(req, env, send);
      if (req.method === 'GET' && url.pathname === '/api/payments') {
        if (!(await userOf(req, env))) return send(401, { error: 'Откройте приложение из Telegram' });
        const p = (await env.CONFIG.get('payments', 'json')) || {};
        return send(200, { rub: p.rub || null, usdt: p.usdt || null, qr: !!(await env.CONFIG.get('qr_thai', 'arrayBuffer')) });
      }
      if (req.method === 'GET' && url.pathname === '/api/payments/qr') {
        if (!(await userOf(req, env))) return send(401, { error: 'Откройте приложение из Telegram' });
        const img = await env.CONFIG.get('qr_thai', 'arrayBuffer');
        return img ? new Response(img, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300', ...cors } }) : send(404, { error: 'Нет QR' });
      }
      if (req.method === 'PUT' && url.pathname === '/api/admin/config') {
        if (!(await isAdmin(req, env))) return send(403, { error: 'Нет доступа' });
        const raw = await req.text();
        if (raw.length > 300_000) return send(413, { error: 'Слишком большой запрос' });
        const body = JSON.parse(raw || '{}');
        const cur = await readState(env);
        if (body.rev !== cur.rev) return send(409, { error: 'Данные уже изменены', ...cur });
        let config;
        try { config = sanitize(body.config); } catch (e) { return send(400, { error: e.message }); }
        const next = { rev: cur.rev + 1, config };
        await env.CONFIG.put('state', JSON.stringify(next));
        return send(200, next);
      }
      return send(404, { error: 'Not found' });
    } catch (e) { return send(400, { error: e.message || 'Bad request' }); }
  },
};
