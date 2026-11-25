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
const OK_TYPES = { 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'image/webp': 'photo.webp', 'application/pdf': 'receipt.pdf' };
const METHOD_NAME = { thb: 'Тайский счёт (PromptPay)', rub: 'Российский счёт', usdt: 'Крипта (USDT TRC-20)', free: 'Бесплатно', manager: 'Нет возможности оплатить' };

// Города с ценой «мужчины / девушки» (должно совпадать с GENDER_PRICE в docs/app.js). Оплаты в местной валюте пока нет.
const GENDER_PRICE = { bali: { cur: 'IDR', m: 600000, f: 400000, rub: { m: 3000, f: 2500 }, usdt: { m: 37, f: 30 } } };
const num = (x) => Number(x).toLocaleString('ru-RU');

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
  if (hasFile && (file.size > 8e6 || !OK_TYPES[file.type])) return send(400, { error: 'Чек: фото (JPG, PNG) или PDF до 8 МБ' });

  const d = new Date(date + 'T00:00:00Z');
  const when = `${WD_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${ev.time}`;
  const [yy, mo, dd] = date.split('-').map(Number), [hh, mi] = ev.time.split(':').map(Number);
  const unix = Math.floor((Date.UTC(yy, mo - 1, dd, hh, mi) - (city?.tz ?? 0) * 3600e3) / 1000); // начало игры по времени города
  const comment = String(f.get('comment') || '').trim().slice(0, 300);
  const head = method === 'manager' ? '⚠️ <b>Нет возможности оплатить</b> — свяжитесь с клиентом' : method === 'free' ? '🎟 <b>Новая запись</b> · бесплатно' : '🧾 <b>Новая запись + чек</b>';
  const text = [
    head, '',
    `<blockquote>🎭 <b>${h(ev.title)}</b>\n📅 ${h(when)}\n📍 ${h(ev.place)}${ev.area ? ', ' + h(ev.area) : ''}${city ? ' (' + h(city.name) + ')' : ''}</blockquote>`, '',
    `👥 <b>${n}</b> чел.${gp ? ` (муж.: ${men}, дев.: ${women})` : ''}${method === 'free' || method === 'manager' ? '' : ` · 💳 ${METHOD_NAME[method]}`}`,
    ...(amount ? [`💰 <b>${h(amount)}</b>`] : []), ...(local ? [`🏷 По прайсу: ${h(local)}`] : []), '',
    who(user),
    ...(comment ? ['', quote(comment)] : []),
  ].join('\n');

  // запись о заявке — для кнопки «Подтвердить» (хранится 60 дней)
  const rid = crypto.randomUUID().slice(0, 8), kind = method === 'manager' ? 'manager' : 'paid';
  const chatUrl = city?.about?.tg || '';
  await env.CONFIG.put('reg:' + rid, JSON.stringify({ uid: user.id, uname: user.username || '', html: text, file: !!hasFile, kind, title: ev.title, when, place: ev.place, chat: chatUrl, city: ev.city, name: fullName(user), n }), { expirationTtl: 60 * 86400 });
  const markup = { inline_keyboard: [[{ text: kind === 'manager' ? '✅ Обработано' : '✅ Подтвердить', callback_data: 'ok:' + rid, style: 'success' }], profileRow(user)] };

  const logBase = { ...userLog(user), c: ev.city, e: ev.title, d: when, p: n, m: METHOD_NAME[method], s: amount, k: kind, r: rid };
  const delivered = await deliver(env, ev.city, text, hasFile ? file : null, markup, logBase);
  if (!delivered) return send(502, { error: 'Не удалось отправить заявку менеджеру. Попробуйте позже.' });
  await rate.bump();
  await logAdd(env, { ...logBase, a: 'reg', x: comment });
  // мои записи — чтобы приложение показывало «Вы записаны» вместо кнопки
  const myKey = `my:${user.id}`, mine = ((await env.CONFIG.get(myKey, 'json')) || []).filter((x) => !(x.e === ev.id && x.d === date));
  mine.push({ e: ev.id, d: date, k: kind, r: rid });
  await env.CONFIG.put(myKey, JSON.stringify(mine.slice(-30)), { expirationTtl: 120 * 86400 });

  // подтверждение клиенту в чат с ботом (если не получится — не страшно)
  const ack = method === 'manager'
    ? `📨 Заявка отправлена. Менеджер свяжется с вами в ближайшее время.\n\n${h(ev.title)} — ${h(when)}`
    : `✅ <b>Вы записаны на игру!</b>\n\n🎭 ${h(ev.title)}\n📅 ${h(when)}\n📍 ${h(ev.place)}\n\nХорошего дня и до встречи!`;
  await tgCall(env, 'sendMessage', { chat_id: user.id, text: ack + (chatUrl ? '\n\n💬 Вступайте в наш чат — там анонсы игр и общение с игроками.' : ''), parse_mode: 'HTML', ...(chatUrl ? { reply_markup: { inline_keyboard: [[{ text: '💬 Вступить в чат', url: chatUrl }]] } } : {}) });
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
  // вопрос по конкретной игре: проверяем мероприятие по конфигу, дату — по формату
  let about = '', evTitle = '';
  const st = await readState(env);
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
  if (!(await deliver(env, cityId, full, null, { inline_keyboard: [profileRow(user)] }, { ...logBase, k: type }))) return send(502, { error: 'Не удалось отправить. Попробуйте позже.' });
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
  const myKey = `my:${rec.uid}`, mine = (await env.CONFIG.get(myKey, 'json')) || [];
  if (mine.some((x) => x.r === id)) await env.CONFIG.put(myKey, JSON.stringify(mine.map((x) => (x.r === id ? { ...x, c: 1 } : x))), { expirationTtl: 120 * 86400 });
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
      if (req.method === 'GET' && url.pathname === '/api/my') {
        const u = await userOf(req, env);
        if (!u) return send(401, { error: 'Откройте приложение из Telegram' });
        const today = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
        return send(200, { items: ((await env.CONFIG.get(`my:${u.id}`, 'json')) || []).filter((x) => x.d >= today).map(({ e, d, k, c }) => ({ e, d, k, c: !!c })) });
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
      return send(404, { error: 'Not found' });
    } catch (e) { return send(400, { error: e.message || 'Bad request' }); }
  },
};
