// Cloudflare Worker: API для мини-аппа Game Phuket (города и афиша).
// Хранилище — Workers KV (ключ "state"). Тот же API, что и в server.js.
import DEFAULT_CFG from '../docs/default-config.json';
import { gpEnabled, gpGames, gpRefs, gpSignup, gpRequest, gpReceipt, gpCreateGame, gpPatchGame } from './gpApi.js';

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
      place: str(e.place, 100), area: str(e.area, 80), map: /^https:\/\/[^\s<>"']+$/i.test(String(e.map || '').trim()) ? String(e.map).trim().slice(0, 300) : '', dur: str(e.dur, 120), desc: str(e.desc, 1000), blue: !!e.blue, active: e.active !== false, price: null };
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
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, caption: text })) fd.append(k, String(v));
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  fd.append('photo', file, OK_TYPES[file.type]);
  return tgJson(env, 'sendPhoto', fd);
}
// Менеджеры по городам: секрет CITY_MANAGERS = "phuket:111,bali:222" (несколько id через |)
function cityManagers(env, cityId) {
  const out = {};
  for (const m of String(env.CITY_MANAGERS || '').matchAll(/([A-Za-z0-9_-]+)\s*:\s*([\d|\s]+)/g)) out[m[1]] = m[2].split('|').map((s) => s.trim()).filter(Boolean);
  return cityId === undefined ? out : out[cityId] || [];
}
const allManagerIds = (env) => [...new Set([...Object.values(cityManagers(env)).flat(), ...managers(env)])];
// Заявка уходит в личку менеджерам города; если не дошла (менеджер не нажал /start в боте и т.п.) — админам
async function deliver(env, cityId, text, file, markup, logBase) {
  let n = 0;
  const errs = [];
  for (const id of cityManagers(env, cityId)) {
    const r = await post(env, id, null, text, file, markup);
    if (r.ok) n++; else errs.push(`${id}: ${/initiate|blocked|chat not found|deactivated/i.test(r.description || '') ? 'менеджер не запустил бота или заблокировал его' : r.description || 'ошибка'}`);
  }
  if (n) return n;
  await logAdd(env, { ...logBase, a: 'fail', x: errs.join('; ') || `нет менеджера для города ${cityId || '—'}` });
  const warn = `⚠️ <i>Не доставлено менеджеру города${errs.length ? ' (он не запустил бота или заблокировал его)' : ''}</i>\n\n`;
  for (const id of managers(env)) if ((await post(env, id, null, warn + text, file, markup)).ok) n++;
  return n;
}

/* ---------- Журнал: каждое событие — отдельный ключ KV, данные в metadata (новые — первыми) ---------- */
async function logAdd(env, o) {
  const t = Date.now(), meta = { t };
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') meta[k] = typeof v === 'string' ? v.slice(0, k === 'x' ? 200 : 80) : v;
  while (enc.encode(JSON.stringify(meta)).length > 1000 && meta.x) meta.x = meta.x.slice(0, Math.floor(meta.x.length / 2));
  try { await env.CONFIG.put(`log:${String(9e12 - t).padStart(13, '0')}:${crypto.randomUUID().slice(0, 6)}`, '', { metadata: meta, expirationTtl: 400 * 86400 }); } catch { /* журнал не должен ломать запись */ }
}
async function logRead(env, { city, types, cursor, want = 50 }) {
  const items = [];
  let cur = cursor || undefined, pages = 0, done = false;
  while (items.length < want && pages < 6) {
    const r = await env.CONFIG.list({ prefix: 'log:', limit: 200, cursor: cur });
    pages++;
    for (const k of r.keys) {
      const m = k.metadata; if (!m) continue;
      if (city && m.c !== city) continue;
      if (types && !types.includes(m.a)) continue;
      items.push(m);
    }
    if (r.list_complete) { done = true; break; }
    cur = r.cursor;
  }
  return { items, cursor: done ? null : cur };
}
const userLog = (u) => ({ u: u.id, n: fullName(u), un: u.username || '' });

async function rateOk(env, user, kind, max) {
  const key = `rl:${kind}:${user.id}`, used = Number(await env.CONFIG.get(key)) || 0;
  return { ok: used < max, bump: () => env.CONFIG.put(key, String(used + 1), { expirationTtl: 3600 }) };
}
const userOf = (req, env) => validateInitData(req.headers.get('X-Init-Data') || '', env.BOT_TOKEN);
const OK_TYPES = { 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'image/webp': 'photo.webp' };
const METHOD_NAME = { thb: 'Тайский счёт (PromptPay)', rub: 'Российский счёт', usdt: 'Крипта (USDT TRC-20)', free: 'Бесплатно', manager: 'Нет возможности оплатить' };

// Города с ценой «мужчины / девушки» (должно совпадать с GENDER_PRICE в docs/app.js). Оплаты в местной валюте пока нет.
const GENDER_PRICE = { bali: { cur: 'IDR', m: 600000, f: 400000, rub: { m: 3000, f: 2500 }, usdt: { m: 37, f: 30 } } };
const num = (x) => Number(x).toLocaleString('ru-RU');

const initOf = (req) => req.headers.get('X-Init-Data') || '';
// Ошибку клуба показываем как есть: текст у них по-русски и предназначен для игрока
const gpFail = (send, e) => {
  if (!e.code) throw e;
  console.log('club api:', e.status, e.code, e.message);
  return send(e.status >= 500 ? 502 : e.status || 502, { error: e.message, code: e.code, ...(e.game ? { game: e.game } : {}) });
};
// Ключ повтора: одно нажатие «Отправить» не выполняется дважды
const idemKey = (user, v) => (/^[A-Za-z0-9-]{8,40}$/.test(String(v || '')) ? `${user.id}-${v}` : crypto.randomUUID());
const PAY_API = { thb: 'thai_bank', rub: 'rub', usdt: 'usdt', free: 'cash' };

async function register(req, env, send) {
  const user = await userOf(req, env);
  if (!user) return send(401, { error: 'Откройте приложение из Telegram' });
  if (Number(req.headers.get('Content-Length')) > 12e6) return send(413, { error: 'Файл слишком большой' });
  const rate = await rateOk(env, user, 'reg', 6);
  if (!rate.ok) return send(429, { error: 'Слишком много заявок, попробуйте через час' });

  const f = await req.formData();
  const state = await readAfisha(env);
  const ev = state.config.events.find((e) => e.id === f.get('eventId') && e.active !== false);
  if (!ev) return send(400, { error: 'Мероприятие не найдено' });
  const city = state.config.cities.find((c) => c.id === ev.city);
  const date = String(f.get('date') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return send(400, { error: 'Неверная дата' });
  const gp = ev.price !== 0 ? GENDER_PRICE[ev.city] : null;
  const legacy = gp && f.get('men') === null; // старая версия приложения прислала только count
  const men = legacy ? Number(f.get('count')) : Number(f.get('men')), women = legacy ? 0 : Number(f.get('women'));
  const n = gp ? men + women : Number(f.get('count'));
  if (gp && !(Number.isInteger(men) && Number.isInteger(women) && men >= 0 && women >= 0)) return send(400, { error: 'Неверное количество' });
  if (!Number.isInteger(n) || n < 1 || n > 10) return send(400, { error: 'Неверное количество' });
  let method = String(f.get('method') || '');
  if (ev.price === 0) method = 'free';
  if (!['thb', 'rub', 'usdt', 'manager', 'free'].includes(method)) return send(400, { error: 'Неверный способ оплаты' });
  const pay = (await env.CONFIG.get('payments', 'json')) || {};
  let amount = '';
  if (gp) {
    if (method === 'thb') return send(400, { error: 'Способ недоступен' });
    if (method === 'rub') { if (!pay.rub) return send(400, { error: 'Способ недоступен' }); amount = `${num(gp.rub.m * men + gp.rub.f * women)} ₽`; }
    if (method === 'usdt') { if (!pay.usdt) return send(400, { error: 'Способ недоступен' }); amount = `${gp.usdt.m * men + gp.usdt.f * women} USDT`; }
  } else {
    if (method === 'thb') { if (!(ev.price > 0)) return send(400, { error: 'Сумма не задана' }); amount = `${ev.price * n} ฿`; }
    if (method === 'rub') { if (!pay.rub?.perPlayer) return send(400, { error: 'Способ недоступен' }); amount = `${pay.rub.perPlayer * n} ₽`; }
    if (method === 'usdt') { if (!pay.usdt?.perPlayer) return send(400, { error: 'Способ недоступен' }); amount = `${pay.usdt.perPlayer * n} USDT`; }
  }
  const local = gp ? `${num(gp.m * men + gp.f * women)} ${gp.cur}` : '';

  const needFile = ['thb', 'rub', 'usdt'].includes(method);
  const file = f.get('receipt');
  const hasFile = file && typeof file === 'object' && file.size > 0;
  if (needFile && !hasFile) return send(400, { error: 'Прикрепите чек об оплате' });
  if (hasFile && (file.size > 8e6 || !OK_TYPES[file.type])) return send(400, { error: 'Чек: фото или скриншот (JPG, PNG) до 8 МБ' });

  const d = new Date(date + 'T00:00:00Z');
  const when = `${WD_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${ev.time}`;
  const comment = String(f.get('comment') || '').trim().slice(0, 300);

  // Запись = присланная через бота оплата: только она попадает в базу клуба как запись.
  // «Связаться с менеджером» — не запись, а заявка (раздел «Заявки» в админке клуба)
  let saved = null;
  try {
    if (method === 'manager') {
      const about = [`Хочет записаться, но не может оплатить предложенными способами.`, `Игра: ${ev.title}, ${when}, ${ev.place}`, `Человек: ${n}`, comment].filter(Boolean).join('\n');
      await gpRequest(env, initOf(req), { kind: 'question', text: about, contact: user.username ? '@' + user.username : '', lang: 'ru' }, idemKey(user, f.get('idem')));
    } else {
      const receipt = hasFile ? await gpReceipt(file) : undefined;
      saved = await gpSignup(env, initOf(req), ev.id.slice(2), { seats: n, payMethod: PAY_API[method], receipt }, idemKey(user, f.get('idem')));
    }
  } catch (e) { return gpFail(send, e); }
  const head = method === 'manager' ? '⚠️ <b>Нет возможности оплатить</b> — свяжитесь с клиентом' : method === 'free' ? '🎟 <b>Новая запись</b> · бесплатно' : '🧾 <b>Новая запись + чек</b>';
  const text = [
    head, '',
    `<blockquote>🎭 <b>${h(ev.title)}</b>\n📅 ${h(when)}\n📍 ${h(ev.place)}${ev.area ? ', ' + h(ev.area) : ''}${city ? ' (' + h(city.name) + ')' : ''}</blockquote>`, '',
    `👥 <b>${n}</b> чел.${gp ? ` (муж.: ${men}, дев.: ${women})` : ''}${method === 'free' || method === 'manager' ? '' : ` · 💳 ${METHOD_NAME[method]}`}`,
    ...(amount ? [`💰 <b>${h(amount)}</b>`] : []), ...(local ? [`🏷 По прайсу: ${h(local)}`] : []), '',
    who(user),
    ...(comment ? ['', quote(comment)] : []),
  ].join('\n');

  const rid = crypto.randomUUID().slice(0, 8), kind = method === 'manager' ? 'manager' : 'paid';
  const chatUrl = city?.about?.tg || '';
  // для кнопки «Обработано» у заявки без оплаты (хранится 60 дней)
  if (kind === 'manager') await env.CONFIG.put('reg:' + rid, JSON.stringify({ uid: user.id, uname: user.username || '', html: text, file: false, kind, title: ev.title, when, place: ev.place, chat: chatUrl, city: ev.city, name: fullName(user), n }), { expirationTtl: 60 * 86400 });
  // оплату отдельно не подтверждают: присланный чек и есть подтверждение
  const markup = { inline_keyboard: [...(kind === 'manager' ? [[{ text: '✅ Обработано', callback_data: 'ok:' + rid, style: 'success' }]] : []), profileRow(user)] };

  const logBase = { ...userLog(user), c: ev.city, e: ev.title, d: when, p: n, m: METHOD_NAME[method], s: amount, k: kind, r: rid };
  // в базу клуба уже отправлено: если сообщение менеджеру не дошло, гостю всё равно отвечаем успехом (в журнале будет «не доставлено»)
  await deliver(env, ev.city, saved ? `${text}\n\n🗂 Запись в базе клуба №${saved.signup_id}` : text, hasFile ? file : null, markup, logBase);
  await rate.bump();
  await logAdd(env, { ...logBase, a: 'reg', x: comment });

  // подтверждение клиенту в чат с ботом (если не получится — не страшно)
  const ack = method === 'manager'
    ? `📨 Заявка отправлена. Менеджер свяжется с вами в ближайшее время.\n\n${h(ev.title)} — ${h(when)}`
    : `✅ <b>Вы записаны на игру!</b>\n\n🎭 ${h(ev.title)}\n📅 ${h(when)}\n📍 ${h(ev.place)}\n\nХорошего дня и до встречи!`;
  await tgCall(env, 'sendMessage', { chat_id: user.id, text: ack + (chatUrl ? '\n\n💬 Вступайте в наш чат — там анонсы игр и общение с игроками.' : ''), parse_mode: 'HTML', ...(chatUrl ? { reply_markup: { inline_keyboard: [[{ text: '💬 Вступить в чат', url: chatUrl }]] } } : {}) });
  return send(200, { ok: true, kind: method === 'manager' ? 'manager' : 'paid' });
}

const REQ_KIND = { ask: 'question', coop: 'partnership', order: 'order', custom: 'event' };
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
  // вопрос по конкретной игре: проверяем мероприятие по конфигу, дату — по формату
  let about = '', evTitle = '';
  const st = await readAfisha(env);
  let cityId = st.config.cities.some((c) => c.id === b.city) ? b.city : '';
  if (b.eventId) {
    const ev = st.config.events.find((e) => e.id === b.eventId);
    if (ev) {
      cityId = ev.city; evTitle = ev.title;
      const city = st.config.cities.find((c) => c.id === ev.city);
      let when = ev.time;
      if (/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') && !Number.isNaN(Date.parse(b.date))) {
        const d = new Date(b.date + 'T00:00:00Z');
        when = `${WD_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${ev.time}`;
      }
      about = `<blockquote>🎭 <b>${h(ev.title)}</b>\n📅 ${h(when)}\n📍 ${h(ev.place)}${city ? ' (' + h(city.name) + ')' : ''}</blockquote>`;
    }
  }
  if (type === 'ask') { if (!message) return send(400, { error: 'Напишите вопрос' }); head = about ? '❓ <b>Вопрос по игре</b>' : '❓ <b>Вопрос</b>'; lines = [...(about ? [about, ''] : []), quote(message)]; }
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
  const cityName = st.config.cities.find((c) => c.id === cityId)?.name;
  const logBase = { ...userLog(user), c: cityId, e: evTitle, x: [type === 'order' ? (b.formats || []).join(', ') : '', message, contact !== user.username && contact !== '@' + user.username ? contact : ''].filter(Boolean).join(' · ') };
  const full = cityName ? text.replace('\n', ` · ${h(cityName)}\n`) : text;
  const guestsN = Math.round(Number(b.guests));
  const plain = [
    cityName ? `Город: ${cityName}` : '',
    name ? `Имя: ${name}` : '',
    evTitle ? `Игра: ${evTitle}${b.date ? `, ${b.date}` : ''}` : '',
    (type === 'order' || type === 'custom') && /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? `Дата: ${b.date}` : '',
    (type === 'order' || type === 'custom') && guestsN >= 1 && guestsN <= 1000 ? `Гостей: ${guestsN}` : '',
    type === 'order' ? `Игры: ${(Array.isArray(b.formats) ? b.formats : []).map((x) => t(x, 30)).filter(Boolean).slice(0, 10).join(', ')}` : '',
    type === 'order' ? `Язык игры: ${b.lang === 'EN' ? 'English' : 'Русский'}` : '',
    message,
  ].filter(Boolean).join('\n');
  try {
    await gpRequest(env, initOf(req), { kind: REQ_KIND[type], text: plain, contact, lang: type === 'order' && b.lang === 'EN' ? 'en' : 'ru' }, idemKey(user, b.idem));
  } catch (e) { return gpFail(send, e); }
  await deliver(env, cityId, full, null, { inline_keyboard: [profileRow(user)] }, { ...logBase, k: type });
  await rate.bump();
  await logAdd(env, { ...logBase, a: type });
  const ack = { ask: '📨 Вопрос получен. Ответим в ближайшее время.', coop: '📨 Предложение получено. Менеджер свяжется с вами.', order: '📨 Заявка на мероприятие получена. Менеджер свяжется с вами в ближайшее время.', custom: '📨 Заявка на ваше мероприятие получена. Менеджер свяжется с вами в ближайшее время.' }[type];
  await tgCall(env, 'sendMessage', { chat_id: user.id, text: ack });
  return send(200, { ok: true });
}

/* ---------- Бот на вебхуке: /start, /id, кнопка «Подтвердить» ---------- */
async function canConfirm(env, q) {
  const ids = new Set([...allManagerIds(env), ...(env.ADMIN_IDS || '').split(',').map((s) => s.trim())]);
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
  const line = `${rec.kind === 'manager' ? '✅ <b>Обработано</b>' : '✅ <b>Подтверждено</b>'} · ${h(by)} · ${pad2(bk.getUTCDate())}.${pad2(bk.getUTCMonth() + 1)} ${pad2(bk.getUTCHours())}:${pad2(bk.getUTCMinutes())}`;
  const body = { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: { inline_keyboard: [profileRow({ id: rec.uid, username: rec.uname })] } };
  await tgJson(env, rec.file ? 'editMessageCaption' : 'editMessageText', { ...body, ...(rec.file ? { caption: `${rec.html}\n\n${line}` } : { text: `${rec.html}\n\n${line}` }) });
  await answer(rec.kind === 'manager' ? 'Отмечено ✅' : 'Подтверждено ✅');
  await logAdd(env, { a: 'ok', u: rec.uid, n: rec.name, un: rec.uname, c: rec.city, e: rec.title, d: rec.when, p: rec.n, k: rec.kind, r: id, b: by, bu: q.from.id });
  if (rec.kind !== 'manager') await tgCall(env, 'sendMessage', { chat_id: rec.uid, parse_mode: 'HTML', text: `✅ <b>Запись подтверждена</b>\n\n<blockquote>🎭 <b>${h(rec.title)}</b>\n📅 ${h(rec.when)}\n📍 ${h(rec.place)}</blockquote>\n\nЖдём вас! 🎭` , ...(rec.chat ? { reply_markup: { inline_keyboard: [[{ text: '💬 Наш чат', url: rec.chat }]] } } : {}) });
}
async function onUpdate(env, u) {
  if (u.callback_query) return onCallback(env, u.callback_query);
  const m = u.message;
  if (!m?.text) return;
  if (/^\/start(@\w+)?(\s|$)/.test(m.text) && m.chat.type === 'private') {
    if (!(await env.CONFIG.get('seen:' + m.from.id))) { await env.CONFIG.put('seen:' + m.from.id, '1'); await logAdd(env, { a: 'new', ...userLog(m.from) }); }
    return tgCall(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML',
      text: 'Приветствую! 🎭\n<b>Game Phuket</b> — мафия-клуб на Пхукете.\n\nАфиша, запись на игры, частные мероприятия и сотрудничество — всё в приложении 👇',
      reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Game Phuket', web_app: { url: env.WEBAPP_URL } }]] } });
  }
  if (/^\/log(@\w+)?(\s|$)/.test(m.text) && m.chat.type === 'private') {
    const uid = String(m.from.id), isAdm = (env.ADMIN_IDS || '').split(',').map((s) => s.trim()).includes(uid);
    const mine = Object.entries(cityManagers(env)).filter(([, ids]) => ids.includes(uid)).map(([c]) => c);
    if (!isAdm && !mine.length) return;
    const st = await readState(env), cityName = (id) => st.config.cities.find((c) => c.id === id)?.name || '';
    const { items } = await logRead(env, { want: 15, types: ['reg', 'ok', 'ask', 'coop', 'order', 'custom', 'fail'] });
    const list = items.filter((x) => isAdm || mine.includes(x.c)).slice(0, 15);
    const lines = list.map((x) => {
      const bk = new Date(x.t + 7 * 3600e3), at = `${pad2(bk.getUTCDate())}.${pad2(bk.getUTCMonth() + 1)} ${pad2(bk.getUTCHours())}:${pad2(bk.getUTCMinutes())}`;
      const nm = x.un ? '@' + h(x.un) : `<a href="tg://user?id=${x.u}">${h(x.n || x.u)}</a>`;
      const what = { reg: x.k === 'manager' ? '⚠️ запись без оплаты' : '🎟 запись', ok: '✅ подтверждено', ask: '❓ вопрос', coop: '🤝 сотрудничество', order: '🎉 заказ игр', custom: '✨ своё мероприятие', fail: '⛔ не доставлено' }[x.a] || x.a;
      return `<b>${at}</b> ${what} · ${nm}${x.e ? ' · ' + h(x.e) : ''}${x.p ? ` · ${x.p} чел.` : ''}${x.b ? ' · ' + h(x.b) : ''}${isAdm && x.c ? ' · ' + h(cityName(x.c)) : ''}`;
    });
    return tgCall(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: lines.length ? `📒 <b>Последние события</b>\n\n${lines.join('\n')}\n\nПолный журнал — в приложении, вкладка «Админ».` : '📒 Журнал пока пуст.' });
  }
  if (/^\/id(@\w+)?(\s|$)/.test(m.text)) {
    const text = m.chat.type === 'private' ? `Ваш Telegram ID: <code>${m.from.id}</code>` : `ID этого чата: <code>${m.chat.id}</code>${m.message_thread_id ? `\nТема: <code>${m.message_thread_id}</code>` : ''}`;
    return tgCall(env, 'sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text, ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });
  }
}

const readState = async (env) => (await env.CONFIG.get('state', 'json')) || { rev: 1, config: DEFAULT_CFG };

/* ---------- Афиша из админки клуба ---------- */
const CLUB_CITY = 'phuket'; // в API клуба нет городов: все игры — пхукетские, остальные города берутся из KV
const clubEvent = (g) => {
  const title = g.title_ru || g.format?.name_ru || (g.kind === 'event' ? 'Мероприятие' : 'Игра');
  const place = g.place || (g.venue ? { name: g.venue.name_ru, maps_url: g.venue.maps_url } : null);
  return {
    id: 'gp' + g.id, city: CLUB_CITY, repeat: 'once', date: g.starts_at.slice(0, 10), time: g.starts_at.slice(11, 16),
    type: g.kind === 'event' ? title : g.format?.name_ru || title, title,
    place: place?.name || 'Место уточняется', area: g.district?.name || '',
    map: /^https:\/\//.test(place?.maps_url || '') ? place.maps_url : '',
    price: Number.isFinite(g.price_thb) ? g.price_thb : null, dur: '', desc: '', blue: g.kind === 'event', active: true,
  };
};
let clubCache = { at: 0, events: [] }; // клуб разрешает кэшировать список игр не дольше 60 секунд
async function clubEvents(env) {
  if (!gpEnabled(env)) return [];
  if (Date.now() - clubCache.at < 60e3) return clubCache.events;
  try {
    const { games } = await gpGames(env);
    clubCache = { at: Date.now(), events: (games || []).filter((g) => g?.id && g.starts_at).map(clubEvent) };
  } catch (e) {
    console.log('club api:', e.code, e.message); // клуб недоступен — отдаём последний удачный список
  }
  return clubCache.events;
}
// Мероприятия берутся только из админки клуба (в KV остаются города и «О нас»)
async function readAfisha(env) {
  const state = await readState(env);
  return { ...state, config: { ...state.config, events: await clubEvents(env) } };
}

// Вкладка «Админ»: наши админы и менеджеры городов. Права на изменение всё равно проверяет клуб («Настройки → Бот»)
async function isStaff(req, env) {
  const u = await userOf(req, env);
  return !!u && [...allManagerIds(env), ...String(env.ADMIN_IDS || '').split(',').map((x) => x.trim())].includes(String(u.id));
}
const GAME_FIELDS = ['kind', 'status', 'expect_updated_at', 'date', 'time', 'gather_time', 'game_type_id', 'venue_id', 'host_id', 'price_thb', 'title_ru', 'description_ru', 'place_name', 'place_address', 'place_maps_url'];
async function adminGames(req, env, url, send) {
  if (!(await isStaff(req, env))) return send(403, { error: 'Нет доступа' });
  const initData = initOf(req), gameId = url.pathname.split('/')[4];
  try {
    if (req.method === 'GET' && !gameId) {
      const day = (shift) => new Date(Date.now() + 7 * 3600e3 + shift * 86400e3).toISOString().slice(0, 10); // даты — по Пхукету
      const [list, refs] = await Promise.all([gpGames(env, { from: day(0), to: day(61), initData }), gpRefs(env, initData)]);
      return send(200, { games: list.games || [], refs });
    }
    if ((req.method === 'POST' && !gameId) || (req.method === 'PATCH' && gameId)) {
      const raw = await req.text();
      if (raw.length > 20000) return send(413, { error: 'Слишком большой запрос' });
      const b = JSON.parse(raw || '{}'), body = Object.fromEntries(GAME_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
      const res = gameId ? await gpPatchGame(env, initData, gameId, body) : await gpCreateGame(env, initData, body);
      clubCache.at = 0; // афиша обновится при следующем открытии
      return send(200, res);
    }
    return send(404, { error: 'Not found' });
  } catch (e) { return gpFail(send, e); }
}

/* ---------- Фото и видео «Как проходят игры» ---------- */
// Список — ключ KV gallery. Старые файлы лежат на сайте (id «s-…»), загруженные из админки — в KV (media:<id>, :t превью, :p обложка видео)
const GAL_DEFAULT = (() => {
  const out = []; let p = 1;
  for (let v = 1; v <= 11 || p <= 21; v++) {
    if (v <= 11) out.push({ id: `s-v${v}`, v: true, city: 'phuket' });
    for (let k = 0; k < 2 && p <= 21; k++, p++) out.push({ id: `s-p${p}`, v: false, city: 'phuket' });
  }
  return out;
})();
const readGallery = async (env) => (await env.CONFIG.get('gallery', 'json')) || GAL_DEFAULT;
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'], VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MEDIA_MAX = 24 * 1024 * 1024; // предел одного значения KV — 25 МБ
async function uploadMedia(req, env, send) {
  if (!(await isStaff(req, env))) return send(403, { error: 'Нет доступа' });
  if (Number(req.headers.get('Content-Length')) > MEDIA_MAX + 2e6) return send(413, { error: 'Файл больше 24 МБ' });
  const f = await req.formData(), video = f.get('video') === '1';
  const file = f.get('file'), thumb = f.get('thumb'), poster = f.get('poster');
  const ok = (x, types, max) => x && typeof x === 'object' && x.size > 0 && x.size <= max && types.includes(x.type);
  if (!ok(file, video ? VIDEO_TYPES : IMG_TYPES, video ? MEDIA_MAX : 5e6)) return send(400, { error: video ? 'Видео: MP4 или MOV до 24 МБ' : 'Фото: JPG, PNG или WebP до 5 МБ' });
  if (!ok(thumb, IMG_TYPES, 5e5) || (video && !ok(poster, IMG_TYPES, 2e6))) return send(400, { error: 'Не удалось подготовить превью' });
  const id = crypto.randomUUID().replace(/-/g, '');
  const put = async (suffix, x) => env.CONFIG.put('media:' + id + suffix, await x.arrayBuffer(), { metadata: { type: x.type } });
  await Promise.all([put('', file), put(':t', thumb), ...(video ? [put(':p', poster)] : [])]);
  return send(200, { id, v: video });
}
async function editGallery(req, env, send) {
  if (!(await isStaff(req, env))) return send(403, { error: 'Нет доступа' });
  const b = await req.json().catch(() => ({}));
  const remove = new Set((Array.isArray(b.remove) ? b.remove : []).map(String));
  const st = await readState(env);
  const add = (Array.isArray(b.add) ? b.add : []).slice(0, 30)
    .filter((x) => /^[0-9a-f]{32}$/.test(x?.id) && st.config.cities.some((c) => c.id === x.city))
    .map((x) => ({ id: x.id, v: !!x.v, city: x.city }));
  const cur = await readGallery(env);
  const next = [...add, ...cur.filter((x) => !remove.has(x.id) && !add.some((a) => a.id === x.id))];
  if (next.length > 300) return send(400, { error: 'Слишком много файлов — удалите лишние' });
  await env.CONFIG.put('gallery', JSON.stringify(next));
  for (const x of cur) if (remove.has(x.id) && !x.id.startsWith('s-')) await Promise.all(['', ':t', ':p'].map((k) => env.CONFIG.delete('media:' + x.id + k)));
  return send(200, { gallery: next });
}
// Отдача файла; Range нужен, чтобы видео играло на iPhone
async function serveMedia(req, env, id, suffix) {
  const { value, metadata } = await env.CONFIG.getWithMetadata('media:' + id + (suffix ? ':' + suffix : ''), 'arrayBuffer');
  if (!value) return new Response('not found', { status: 404 });
  const headers = { 'Content-Type': metadata?.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || ''), size = value.byteLength;
  if (!m || (!m[1] && !m[2])) return new Response(value, { headers });
  const from = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), to = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (from > to || from >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(value.slice(from, to + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${from}-${to}/${size}` } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const allowed = new Set(['https://meshk0v.github.io', ...(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
    const cors = origin && allowed.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS' }
      : {};
    const send = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const [afisha, gallery] = await Promise.all([readAfisha(env), readGallery(env)]);
        return send(200, { ...afisha, gallery });
      }
      const media = req.method === 'GET' && /^\/api\/media\/([0-9a-f]{32})([tp])?$/.exec(url.pathname);
      if (media) return await serveMedia(req, env, media[1], media[2]);
      if (req.method === 'POST' && url.pathname === '/api/admin/media') return await uploadMedia(req, env, send);
      if (req.method === 'POST' && url.pathname === '/api/admin/gallery') return await editGallery(req, env, send);
      if (req.method === 'POST' && url.pathname === '/api/me') return send(200, { isAdmin: await isStaff(req, env) });
      if (req.method === 'POST' && url.pathname === '/api/tg') {
        if (!env.TG_WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
        try { await onUpdate(env, await req.json()); } catch { /* Telegram не должен получать ошибку и слать повторы */ }
        return new Response('ok');
      }
      if (req.method === 'POST' && url.pathname === '/api/register') return await register(req, env, send);
      if (req.method === 'POST' && url.pathname === '/api/request') return await request(req, env, send);
      if (req.method === 'GET' && url.pathname === '/api/my') {
        const u = await userOf(req, env);
        if (!u) return send(401, { error: 'Откройте приложение из Telegram' });
        // «Вы записаны» — только если по записи есть чек (голос в опросе или запись без оплаты не считаются)
        try {
          const { games } = await gpGames(env, { initData: initOf(req) });
          return send(200, { items: (games || []).filter((x) => x.my_signup?.has_receipt).map((x) => ({ e: 'gp' + x.id, d: x.starts_at.slice(0, 10), k: 'paid', c: !!x.my_signup.paid_confirmed })) });
        } catch (e) { return gpFail(send, e); }
      }
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
      if (req.method === 'POST' && url.pathname === '/api/seen') {
        const u = await userOf(req, env);
        if (!u) return send(401, { error: 'Откройте приложение из Telegram' });
        const b = await req.json().catch(() => ({}));
        const st = await readState(env);
        if (!st.config.cities.some((c) => c.id === b.city)) return send(400, { error: 'Неверный город' });
        const key = 'seen:' + u.id, prev = await env.CONFIG.get(key);
        if (prev !== b.city) {
          await env.CONFIG.put(key, b.city);
          const was = prev && prev !== '1' ? st.config.cities.find((c) => c.id === prev)?.name : '';
          // впервые в приложении — «Новый пользователь» с городом; после /start или смены города — «Выбрал город»
          await logAdd(env, { a: prev ? 'city' : 'new', ...userLog(u), c: b.city, x: was ? 'был: ' + was : '' });
        }
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/log') {
        if (!(await isAdmin(req, env))) return send(403, { error: 'Нет доступа' });
        const types = (url.searchParams.get('types') || '').split(',').filter((s) => /^[a-z]{2,8}$/.test(s));
        return send(200, await logRead(env, { city: url.searchParams.get('city') || '', types: types.length ? types : null, cursor: url.searchParams.get('cursor') || '' }));
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
      if (url.pathname === '/api/admin/games' || /^\/api\/admin\/games\/\d+$/.test(url.pathname)) return await adminGames(req, env, url, send);
      return send(404, { error: 'Not found' });
    } catch (e) { return send(400, { error: e.message || 'Bad request' }); }
  },
};
