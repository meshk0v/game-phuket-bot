/* Game Phuket — демо мини-апп (без бэкенда). Использует Telegram Mini Apps API. */
const tg = window.Telegram?.WebApp;
const inTG = !!tg?.initData;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

/* ---------------- данные ---------------- */
const WD = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/* ---------------- конфиг: города и афиша (редактируется в админке) ---------------- */
const API = (window.GP_API || '').replace(/\/$/, '');
let CFG = { cities: [], events: [] }, API_OK = false;
let MY = []; // мои записи: { e: id мероприятия, d: дата, k: 'paid' | 'manager', c: подтверждено }
let EVENTS = [];
const cityById = (id) => CFG.cities.find((c) => c.id === id);
const pad = (n) => String(n).padStart(2, '0');

async function getJSON(url, opts = {}, ms = 4000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => null) };
  } catch { return { ok: false, status: 0, j: null }; } finally { clearTimeout(t); }
}
async function loadConfig() {
  const r = await getJSON(API + '/api/config');
  if (r.ok && r.j?.config?.cities) { CFG = r.j.config; API_OK = true; ls.set('gp_cfg', JSON.stringify(CFG)); }
  else {
    try { CFG = JSON.parse(ls.get('gp_cfg')); } catch {}               // последняя удачная копия с сервера
    if (!CFG?.cities?.length) CFG = (await getJSON('default-config.json')).j || { cities: [], events: [] }; // встроенная афиша
  }
  if (inTG && API_OK) {
    const my = await getJSON(API + '/api/my', { headers: { 'X-Init-Data': tg.initData } });
    MY = my.j?.items || [];
  }
}

// Ближайшие даты мероприятий выбранного города. Время — по часовому поясу города.
function buildEvents() {
  const tz = cityById(city)?.tz ?? 0, now = Date.now();
  const n = new Date(now + tz * 3600e3);
  const out = [];
  for (const e of CFG.events) {
    if (e.city !== city || e.active === false) continue;
    const [hh, mm] = (e.time || '19:00').split(':').map(Number);
    let local; // «фейковый UTC»: компоненты даты = местное время города
    if (e.repeat === 'once') {
      const [y, m, d] = (e.date || '').split('-').map(Number);
      if (!y) continue;
      local = Date.UTC(y, m - 1, d, hh, mm);
    } else {
      const base = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), hh, mm);
      let add = (e.dow - new Date(base).getUTCDay() + 7) % 7;
      if (add === 0 && base - tz * 3600e3 < now) add = 7; // сегодня, но уже началось
      local = base + add * 86400e3;
    }
    const ts = local - tz * 3600e3;
    if (e.repeat === 'once' && ts < now - 3 * 3600e3) continue; // разовое прошло
    out.push({ ...e, date: new Date(local), dow: new Date(local).getUTCDay(), ts });
  }
  return out.sort((x, y) => x.ts - y.ts);
}
// запись пользователя на конкретную дату мероприятия
const myReg = (e) => MY.find((x) => x.e === e.id && x.d === `${e.date.getUTCFullYear()}-${pad(e.date.getUTCMonth() + 1)}-${pad(e.date.getUTCDate())}`);
const myBadge = (r) => (r.k === 'manager' ? '<span class="booked wait">⏳ Заявка у менеджера</span>' : `<span class="booked">✓ Вы записаны${r.c ? ' · подтверждено' : ''}</span>`);
const fmtDate = (e) => `${e.date.getUTCDate()} ${MON[e.date.getUTCMonth()]}`;
const priceTxt = (p) => (p === 0 ? 'Бесплатно' : p === null || p === undefined || p === '' ? 'Уточняйте' : `${p} ฿`);
// Города с ценой «мужчины / девушки» в местной валюте. Оплаты в местной валюте пока нет — только рубли и USDT (реквизиты общие).
const GENDER_PRICE = { bali: { cur: 'IDR', m: 600000, f: 400000, rub: { m: 3000, f: 2500 }, usdt: { m: 37, f: 30 } } };
const gpOf = (e) => (e && e.price !== 0 ? GENDER_PRICE[e.city] : null);
const num = (x) => Number(x).toLocaleString('ru-RU');
const priceOf = (e) => { const g = gpOf(e); return g ? `от ${num(Math.min(g.m, g.f))} ${g.cur}` : priceTxt(e.price); };
const newReg = (e) => (gpOf(e) ? { id: e.id, n: 0, m: 0, f: 0 } : { id: e.id, n: 1 }); // на Бали гость сам выбирает, сколько мужчин и девушек
const peopleTxt = (r) => (r && r.m !== undefined ? `${r.n} чел. (муж.: ${r.m}, дев.: ${r.f})` : `${r?.n || 1} чел.`);
// Счётчик людей: один («Сколько вас?») или два (мужчины / девушки)
const stepperHtml = (e, r) => (gpOf(e)
  ? [['m', 'Мужчины'], ['f', 'Девушки']].map(([k, t], i) => `<div class="stepper"${i ? ' style="margin-top:8px"' : ''}><div><div style="font-weight:500">${t}</div><div class="mute" style="font-size:12px">${num(gpOf(e)[k])} ${gpOf(e).cur}</div></div>
      <div class="ctl"><button data-st="${k}:-1">−</button><output data-o="${k}">${r[k]}</output><button data-st="${k}:1">+</button></div></div>`).join('')
  : `<div class="stepper"><div><div style="font-weight:500">Сколько вас?</div><div class="mute" style="font-size:12px">можно с друзьями</div></div>
      <div class="ctl"><button data-st="n:-1">−</button><output data-o="n">${r.n}</output><button data-st="n:1">+</button></div></div>`);
function bindStepper(r, onChange) {
  $$('[data-st]').forEach((b) => b.addEventListener('click', () => {
    const [k, d] = b.dataset.st.split(':'), v = r[k] + +d;
    const m = k === 'm' ? v : r.m, f = k === 'f' ? v : r.f, n = k === 'n' ? v : m + f;
    if (v < (k === 'n' ? 1 : 0) || n > 10) return notify('warning');
    r[k] = v; if (k !== 'n') r.n = n; hapticSel();
    const o = $(`[data-o="${k}"]`); if (o) o.textContent = v;
    onChange();
  }));
}
// Сумма в местной валюте (для показа) или по способу оплаты
const localTotal = (e, r) => { const g = gpOf(e); return g ? `${num(g.m * r.m + g.f * r.f)} ${g.cur}` : `${e.price * r.n} ฿`; };
const payTotal = (e, r, pay, method) => {
  const g = gpOf(e);
  if (method === 'thb') return !g && e.price > 0 ? `${e.price * r.n} ฿` : '';
  if (method === 'rub') return !pay?.rub ? '' : g ? `${num(g.rub.m * r.m + g.rub.f * r.f)} ₽` : pay.rub.perPlayer ? `${pay.rub.perPlayer * r.n} ₽` : '';
  if (method === 'usdt') return !pay?.usdt ? '' : g ? `${g.usdt.m * r.m + g.usdt.f * r.f} USDT` : pay.usdt.perPlayer ? `${pay.usdt.perPlayer * r.n} USDT` : '';
  return '';
};

// Тексты ролей и правил — с плакатов Game Phuket «Описание ролей в игре» и «Правила игры»; карты — из набора Game Place
const ROLES = [
  { id: 'sher', n: 'Шериф', side: 'red', team: 'Красный · мирный город',
    t: ['Каждую ночь проверяет одного игрока: Мафия или нет.', '👍 Ведущий показывает большой палец вверх — это Мирный игрок. 👎 Большой палец вниз — значит, этот игрок Мафия или Дон Мафии.', 'Оборотень будет показываться как мирный игрок, пока не перевоплотится в Мафию.'],
    tip: 'Узнай правду. Дождись момента. Назови мафию.' },
  { id: 'doc', n: 'Доктор', side: 'red', team: 'Красный · мирный город',
    t: ['Каждую ночь выбирает одного игрока для лечения.', 'Может лечить себя один раз за всю игру, не может лечить одного и того же игрока два раза подряд.'],
    tip: 'Не спасает от двух убийств.' },
  { id: 'hit', n: 'Хитман', side: 'black', team: 'Чёрный · сам за себя',
    t: ['Маньяк, который играет сам за себя, убивает по ночам, может убить Мафию, должен остаться один на один с любым из игроков.', 'При проверке Шерифа показывается мирным.'],
    tip: 'Хитману выгоднее искать мафию вместе с мирным городом, чтобы мафия ночью не убила его.' },
  { id: 'lov', n: 'Любовница', side: 'red', team: 'Красный · мирный город',
    t: ['Выбирает игрока, которого «приглашает к себе домой», тем самым спасая игрока от смерти.', 'Если в эту ночь был произведён выстрел в Любовницу, умирают и Любовница, и тот игрок, которого она «спасала».'],
    tip: 'Спасая другого, рискуешь собой.' },
  { id: 'det', n: 'Детектив', side: 'red', team: 'Красный · мирный город',
    t: ['Каждую ночь проверяет одного игрока на наличие роли.', '👍 Если ведущий показывает большой палец вверх — это Мирный игрок без роли.', '👉 Если показывает большой палец вбок — значит, у игрока есть любая из активных ролей.'],
    tip: 'Детектив — единственный, кто своей проверкой может найти Хитмана.' },
  { id: 'wolf', n: 'Оборотень', side: 'red', team: 'Красный, пока не обернулся',
    t: ['Играет за Мирных, как только исключают всю Мафию, оборачивается и становится одним из Мафиози. Мафия не может убить Оборотня.', 'Если ночью ведущий показывает большой палец вниз — это означает, что Оборотень становится Мафией. Теперь он просыпается и совершает убийства.'],
    tip: 'Будь готов к перемене в любую ночь.' },
];
const GESTURES = [
  ['👍', 'Большой палец вверх', 'Шерифу — мирный игрок (так же показываются Хитман и Оборотень до перевоплощения). Детективу — мирный без роли.'],
  ['👎', 'Большой палец вниз', 'Шерифу — Мафия или Дон Мафии. Оборотню — он становится Мафией.'],
  ['👉', 'Большой палец вбок', 'Детективу — у игрока есть активная роль.'],
  ['👌', 'Знак «ок»', 'Дону — он нашёл Шерифа.'],
];
const PHASES = [
  ['Ночь', 'Активные роли просыпаются и выполняют свои действия.'],
  ['День', 'Мирный город обсуждает и пытается вычислить мафию.'],
];
const DAY = [
  ['Общее обсуждение', 'Балаган в городе', '2 минуты'],
  ['Индивидуальная речь', 'И выставление на голосование', '30 секунд у каждого'],
  ['Дневное голосование', 'Исключение игрока', ''],
];
const RULES = [
  'Во время ночной фазы все игроки молчат. Запрещены любые жесты, пока на вашем лице есть маска.',
  'Мёртвые игроки молчат и игнорируют любые вопросы.',
  'Всё, что происходит в игре, остаётся в игре. Клятвы и обещания будут наказаны страйком.',
  'Во время ночной фазы озвучиваются все роли, независимо от того, выбыл ли персонаж из игры или остался в ней.',
];
const STRIKE_FOR = [
  'За неуважительное отношение к другим',
  'За оскорбления или нарушение правил',
  'Если игрок перебивает других игроков во время их индивидуальной речи',
  'Если хотите получить дополнительные 20 секунд на индивидуальную речь',
];
const STRIKES = [
  ['Предупредительный', ''],
  ['Без голоса', 'Игрок лишается права голоса на ближайшем голосовании.'],
  ['Молчание', 'Игрок не может общаться с игроками, пока не решит головоломку от ведущего.'],
  ['Удаление', 'Четвёртый страйк — удаление из игры.'],
];

const roleIcon = (r, cls = '') => `<img class="rimg ${cls}" src="img/roles/${r.id}.webp?v=2" alt="${r.n}" loading="lazy">`;
const FORMATS = [
  { n: 'Мафия', s: 'Классическая, тематическая, квиз-мафия' },
  { n: 'Бункер', s: 'Классический или на английском' },
  { n: 'Квест', s: 'Дома или на байках по острову' },
  { n: 'Cash Flow', s: 'Корпоратив или своей компанией' },
  { n: 'Квиз', s: 'Тематический, музыкальный для вашего мероприятия' },
  { n: 'Командные игры', s: 'Авторский набор игр для вашего мероприятия' },
];

/* ---------------- графика ---------------- */
const SPARK = '<svg class="spark" viewBox="0 0 24 24"><path d="M12 0c.9 6.6 4.8 10.6 12 12-7.2 1.4-11.1 5.4-12 12-.9-6.6-4.8-10.6-12-12C7.2 10.6 11.1 6.6 12 0z"/></svg>';
const sparks = () => `<span class="red">${SPARK}</span> ${SPARK}`;
const MASK = (cls = '') => `
<svg class="mask ${cls}" viewBox="0 0 200 260" aria-hidden="true">
  <defs>
    <radialGradient id="mg" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#3a3a3a"/><stop offset=".45" stop-color="#111"/><stop offset="1" stop-color="#000"/></radialGradient>
    <linearGradient id="rim" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2b22" stop-opacity=".9"/><stop offset=".5" stop-color="#ff2b22" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="M100 8C158 8 186 56 183 118c-3 72-43 134-83 134S20 190 17 118C14 56 42 8 100 8z" fill="url(#mg)" stroke="url(#rim)" stroke-width="2"/>
  <path d="M44 116c12-14 30-16 44-2-14 12-32 13-44 2zM156 116c-12-14-30-16-44-2 14 12 32 13 44 2z" fill="#000"/>
  <path d="M78 196c14 9 30 9 44 0-14-3-30-3-44 0z" fill="#050505"/>
  <ellipse cx="66" cy="58" rx="26" ry="14" fill="#fff" opacity=".13" transform="rotate(-28 66 58)"/>
  <ellipse cx="58" cy="168" rx="8" ry="24" fill="#fff" opacity=".05"/>
</svg>`;
const LOGO = '<img class="logo" src="logo.svg?v=2" alt="Game Place" width="125" height="46">';
const header = (right = '') => `<div class="bar"><div class="brand">${LOGO}</div>${right}</div>`;

/* ---------------- Telegram ---------------- */
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred(t);
const hapticSel = () => tg?.HapticFeedback?.selectionChanged();
const notify = (t) => tg?.HapticFeedback?.notificationOccurred(t);
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
// Выбранный город: в Telegram — CloudStorage (привязан к аккаунту, общий для всех устройств),
// вне Telegram — localStorage. localStorage также служит быстрым кэшем.
const CITY_KEY = 'gp_city';
const hasCloud = () => inTG && tg.CloudStorage && tg.isVersionAtLeast?.('6.9');
const ls = {
  get: (k) => { try { return localStorage[k] || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? (localStorage[k] = v) : localStorage.removeItem(k); } catch {} },
};
const store = {
  get: (k) => new Promise((res) => {
    const local = ls.get(k);
    if (!hasCloud()) return res(local);
    const t = setTimeout(() => res(local), 1500); // если Telegram не ответил — не зависаем
    try { tg.CloudStorage.getItem(k, (err, v) => { clearTimeout(t); res(err ? local : v || ''); }); }
    catch { clearTimeout(t); res(local); }
  }),
  set: (k, v) => {
    ls.set(k, v);
    if (hasCloud()) try { v ? tg.CloudStorage.setItem(k, v) : tg.CloudStorage.removeItem(k); } catch {}
  },
};
function openLink(u) { inTG ? tg.openLink(u) : window.open(u, '_blank'); }
// Соцсети Game Phuket
const IG_URL = 'https://www.instagram.com/game.phuket';
const TG_CHAT_URL = 'https://t.me/MafiaPhuket';
function openTgLink(u) { inTG && tg.openTelegramLink ? tg.openTelegramLink(u) : window.open(u, '_blank'); }
const SOC_ICON = {
  tg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#29A9EB"/><path d="M17.6 7.2 15.8 16c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.2-4.7c.2-.2 0-.3-.3-.1l-6.4 4-2.8-.9c-.6-.2-.6-.6.1-.9l10.9-4.2c.5-.2 1 .1.7.9z" fill="#fff"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#igg)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16.1" cy="7.9" r="1" fill="#fff"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#25D366"/><path d="M12 5.6a6.4 6.4 0 0 0-5.5 9.7l-.8 2.9 3-.8A6.4 6.4 0 1 0 12 5.6z" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M9.7 8.9c.1-.3.3-.3.5-.3h.3c.1 0 .3 0 .4.3l.5 1.2c0 .1 0 .3-.1.4l-.3.4c-.1.1-.1.2 0 .4.4.6.8 1 1.4 1.4.2.1.3.1.4 0l.4-.5c.1-.1.3-.1.4-.1l1.2.6c.2.1.3.1.3.3 0 .3-.1.9-.6 1.1-.4.3-1 .3-1.7.1-1-.4-2.2-1.4-2.8-2.4-.5-.8-.5-1.5-.3-1.9z" fill="#fff"/></svg>',
  site: '<svg viewBox="0 0 24 24" fill="none" stroke="#bdbdbd" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4.2" ry="10"/><path d="M2.5 9h19M2.5 15h19"/></svg>',
};
const openAny = (u) => (/^https:\/\/t\.me\//i.test(u) ? openTgLink(u) : openLink(u));
const aboutOf = (id) => cityById(id)?.about || {};
// «@ник» / номер / адрес → полная https-ссылка
function normUrl(v, kind) {
  v = String(v || '').trim();
  if (!v) return '';
  if (v.startsWith('@')) {
    const n = v.slice(1);
    return kind === 'tg' ? `https://t.me/${n}` : kind === 'ig' ? `https://www.instagram.com/${n}` : '';
  }
  if (kind === 'wa' && /^\+?[\d\s()-]{7,}$/.test(v)) return `https://wa.me/${v.replace(/\D/g, '')}`;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v.replace(/^http:/i, 'https:');
}
// подпись под ссылкой: @ник, +номер или домен
function handleOf(u, kind) {
  try {
    const x = new URL(u), first = x.pathname.split('/').filter(Boolean)[0];
    if (kind === 'site') return x.hostname.replace(/^www\./, '');
    if (kind === 'wa') return first ? '+' + first : 'WhatsApp';
    return first ? '@' + first : x.hostname;
  } catch { return u; }
}

let mainFn = null;
function mainButton(text, fn) {
  $('#fbtn')?.remove();
  if (inTG) {
    if (mainFn) tg.MainButton.offClick(mainFn);
    mainFn = null;
    if (!text) return tg.MainButton.hide();
    mainFn = fn;
    tg.MainButton.setParams({ text, color: '#ff2b22', text_color: '#ffffff', is_visible: true, is_active: true });
    tg.MainButton.onClick(fn);
  } else if (text) {
    const b = document.createElement('button');
    b.id = 'fbtn'; b.className = 'btn fixed'; b.textContent = text; b.dataset.t = text; b.onclick = fn;
    document.body.append(b);
  }
}
// Модальное окно в дизайне приложения (вместо системных окон Telegram).
// Возвращает value нажатой кнопки; при закрытии фоном/«Назад» — dismiss; при переходе на другой экран — '__nav'.
function modal({ icon = '', title = '', text = '', buttons = [{ text: 'Хорошо', value: true }], dismiss = null }) {
  return new Promise((resolve) => {
    sheetClose?.(true);
    const el = document.createElement('div');
    el.className = 'modal-wrap';
    el.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true">
        ${icon ? `<div class="modal-ic ${icon === '✓' ? 'ok' : 'warn'}">${icon}</div>` : ''}
        ${title ? `<h3 class="d">${esc(title)}</h3>` : ''}
        ${text ? `<p>${esc(text)}</p>` : ''}
        <div class="modal-btns ${buttons.length > 1 ? 'two' : ''}">${buttons.map((b, i) => `<button class="btn ${b.kind === 'ghost' ? 'ghost' : ''}" data-mi="${i}">${esc(b.text)}</button>`).join('')}</div>
      </div>`;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    const mbWasVisible = inTG && tg.MainButton.isVisible;
    if (mbWasVisible) tg.MainButton.hide();      // нативная кнопка Telegram не должна нажиматься под окном
    if (inTG) tg.BackButton.show();
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true; sheetClose = null;
      el.classList.remove('on'); setTimeout(() => el.remove(), 250);
      if (value !== '__nav') {
        if (inTG && TABS.includes(cur.split('/')[0])) tg.BackButton.hide();
        if (mbWasVisible) tg.MainButton.show();
      }
      resolve(value);
    };
    sheetClose = (instant) => close(instant ? '__nav' : dismiss);
    el.addEventListener('click', (e) => { if (e.target === el) { haptic(); close(dismiss); } });
    $$('[data-mi]', el).forEach((b) => b.addEventListener('click', () => { haptic(); close(buttons[+b.dataset.mi].value); }));
  });
}

function done(title, msg, after) {
  notify('success');
  const fin = after || back; // формы-вкладки остаются на месте, остальные экраны — назад
  modal({ icon: '✓', title, text: msg, buttons: [{ text: 'Хорошо', value: 'ok' }], dismiss: 'ok' }).then((v) => { if (v !== '__nav') fin(); });
}

let seenCity = '';
function reportCity() {
  if (!inTG || !API_OK || !cityById(city) || seenCity === city) return;
  seenCity = city;
  getJSON(API + '/api/seen', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify({ city }) });
}
function resetCity() { haptic(); city = ''; store.set(CITY_KEY, ''); go('city'); }

/* ---------------- роутер ---------------- */
let city = '';
const home = () => { const c = cityById(city); return !c ? 'city' : c.status === 'active' ? 'afisha' : 'soon'; };
const go = (r) => { if (location.hash.slice(1) === r) route(); else location.hash = r; };
const TABS = ['afisha', 'games', 'order', 'club'];
const stack = []; let cur = null, goingBack = false;
function back() {
  haptic();
  if (sheetClose) return sheetClose();
  goingBack = true;
  let p = stack.pop();
  if (!p) p = home();
  go(p);
}
function route() {
  const SCREENS = { city: City, soon: Soon, afisha: Afisha, games: Games, order: Order, club: Club, event: EventPage, custom: Custom, pay: Pay, paydone: PayDone, ask: Ask, coop: Coop, };
  let full = location.hash.slice(1);
  // Telegram дописывает в адрес #tgWebAppData=… — это не экран; неизвестные адреса тоже ведём на стартовый
  if (!SCREENS[full.split('/')[0]]) full = home();
  const [r, ...rest] = full.split('/'); const arg = rest.join('/');
  const root = TABS.includes(r) || r === 'city' || (r === 'soon' && cityById(city)?.status === 'soon');
  if (root) stack.length = 0; // вкладки — корневые экраны
  else if (!goingBack && cur && cur !== full) stack.push(cur);
  goingBack = false; cur = full;
  sheetClose?.(true);
  mainButton(null);
  EVENTS = buildEvents();
  reportCity();
  const isTab = TABS.includes(r);
  document.body.classList.toggle('notabs', !isTab);
  $('#tabs').style.display = r === 'city' || r === 'soon' ? 'none' : '';
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === r));
  if (inTG) root ? tg.BackButton.hide() : tg.BackButton.show();
  const screen = SCREENS[r];
  const backBtn = !inTG && !root ? '<button class="backb" id="backb">← Назад</button>' : '';
  app.innerHTML = `${backBtn}<div class="view">${screen.html(arg)}</div>`;
  $('#backb')?.addEventListener('click', back);
  window.scrollTo(0, 0);
  screen.bind?.(arg);
  $$('[data-go]').forEach((el) => el.addEventListener('click', () => { haptic(); go(el.dataset.go); }));
}
addEventListener('hashchange', route);
$$('#tabs button').forEach((b) => b.addEventListener('click', () => { hapticSel(); go(b.dataset.tab); }));

/* ---------------- экраны ---------------- */
const City = {
  html: () => {
    const first = CFG.cities.findIndex((c) => c.status === 'active');
    return `
  <section class="splash">
    ${MASK('float')}
    <div>
      ${header()}
      <h1 class="d"><span>Мафия</span><span class="red">клуб</span><span style="font-size:.5em;margin-top:10px">${sparks()}</span></h1>
      <p class="lead">2500+ участников. К нам возвращаются даже те, кто не любил Мафию.</p>
    </div>
    <div>
      <p class="cap">Где ты сейчас?</p>
      <div class="cities">${CFG.cities.length ? CFG.cities.map((c, i) => `
        <button class="city ${i === first ? 'hot' : ''}" data-city="${esc(c.id)}"><div><div class="d">${esc(c.name)}</div>${c.status === 'active' ? '' : '<small>скоро открытие</small>'}</div><span class="arrow">→</span></button>`).join('')
        : '<p class="mute">Города пока не добавлены.</p>'}
      </div>
    </div>
  </section>`;
  },
  bind: () => $$('[data-city]').forEach((b) => b.addEventListener('click', () => {
    haptic('medium');
    city = b.dataset.city; store.set(CITY_KEY, city);
    go(home());
  })),
};

const Soon = {
  html: () => {
    const c = cityById(city), other = CFG.cities.find((x) => x.status === 'active');
    return `
  ${header()}
  <section class="splash" style="min-height:70vh;justify-content:center">
    ${MASK('float')}
    <div>
      <p class="cap">${esc(c.name)}</p>
      <h1 class="d" style="font-size:64px;margin-top:14px">Скоро<br><span class="red">открытие</span></h1>
      <p class="lead">Готовим игры в этом городе. Анонс — первым делом в Instagram.</p>
    </div>
  </section>
  ${(aboutOf(city).ig || CFG.cities.find((x) => x.about?.ig)) ? '<button class="btn white" data-ig>Следить в Instagram</button>' : ''}
  ${other ? `<button class="btn ghost" style="margin-top:8px" data-city="${esc(other.id)}">Смотреть афишу: ${esc(other.name)}</button>` : ''}
  <button class="btn ghost" style="margin-top:8px;border:0;color:var(--mute)" data-reset>Сменить город</button>`;
  },
  bind: () => { City.bind(); $('[data-ig]')?.addEventListener('click', () => openLink(aboutOf(city).ig || CFG.cities.find((x) => x.about?.ig).about.ig)); $('[data-reset]').onclick = resetCity; },
};

let selDay = null;
// Фото и видео с игр (Пхукет): лента маленьких превью на афише, по нажатию — полный экран со свайпом
const GALLERY_CITY = 'phuket';
if (!matchMedia('(pointer:coarse)').matches) document.documentElement.classList.add('desk'); // компьютер: стрелки в галерее
// клавиши ← → листают ленту на афише (когда просмотр на весь экран закрыт — там свои)
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || $('.gv') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  const g = $('.gal'); if (!g) return;
  g.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * g.clientWidth * 0.8, behavior: 'smooth' });
});
const GALLERY = (() => {
  const out = []; let p = 1;
  for (let v = 1; v <= 11 || p <= 21; v++) {
    if (v <= 11) out.push({ v: true, i: v });
    for (let k = 0; k < 2 && p <= 21; k++) out.push({ v: false, i: p++ });
  }
  return out;
})();
const MV = 2; // версия медиа — менять при замене файлов в docs/media
const galleryHtml = () => (city !== GALLERY_CITY ? '' : `
    <div class="sec"><h3 class="d">Как проходят <span class="red">игры</span></h3></div>
    <div class="galw"><button class="gal-a l" data-ga="-1" aria-label="Назад">‹</button><button class="gal-a r" data-ga="1" aria-label="Вперёд">›</button><div class="gal">${GALLERY.map((g, k) => `<button class="gi ${g.v ? 'vid' : ''}" data-g="${k}" aria-label="${g.v ? 'Видео' : 'Фото'}"><img src="media/${g.v ? 'v' : 'p'}${g.i}t.webp?v=${MV}" alt="" loading="lazy"></button>`).join('')}</div></div>`);
function openGallery(start) {
  const el = document.createElement('div');
  el.className = 'gv';
  el.innerHTML = `<div class="gv-track">${GALLERY.map((g) => `<div class="gv-s">${g.v
    ? `<video src="media/v${g.i}.mp4?v=${MV}" poster="media/v${g.i}.webp?v=${MV}" controls playsinline preload="none"></video>`
    : `<img src="media/p${g.i}.webp?v=${MV}" alt="" loading="lazy">`}</div>`).join('')}</div>
    <button class="gv-x" aria-label="Закрыть">✕</button><div class="gv-n"></div>
    <button class="gv-a l" data-d="-1" aria-label="Назад">‹</button><button class="gv-a r" data-d="1" aria-label="Вперёд">›</button>`;
  document.body.append(el);
  const tr = $('.gv-track', el), n = $('.gv-n', el), vids = $$('video', el);
  let at = start;
  const show = () => { $('.gv-a.l', el).disabled = at === 0; $('.gv-a.r', el).disabled = at === GALLERY.length - 1; n.textContent = `${at + 1} / ${GALLERY.length}`; vids.forEach((v) => { if (v.closest('.gv-s') !== tr.children[at]) v.pause(); }); };
  tr.scrollLeft = start * tr.clientWidth;
  show();
  const first = $('video', tr.children[start]); if (first) first.play().catch(() => {});
  tr.addEventListener('scroll', () => { const k = Math.round(tr.scrollLeft / tr.clientWidth); if (k !== at) { at = k; hapticSel(); show(); } }, { passive: true });
  requestAnimationFrame(() => el.classList.add('on'));
  // на компьютере — стрелки на экране и на клавиатуре
  const step = (d) => { const k = Math.min(GALLERY.length - 1, Math.max(0, at + d)); tr.scrollTo({ left: k * tr.clientWidth, behavior: 'smooth' }); };
  $$('.gv-a', el).forEach((b) => b.addEventListener('click', () => step(+b.dataset.d)));
  const onKey = (e) => { if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const close = (instant) => {
    sheetClose = null; vids.forEach((v) => v.pause()); document.removeEventListener('keydown', onKey);
    if (instant) return el.remove();
    el.classList.remove('on'); setTimeout(() => el.remove(), 250);
    if (inTG && TABS.includes(cur.split('/')[0])) tg.BackButton.hide();
  };
  sheetClose = close;
  if (inTG) tg.BackButton.show();
  $('.gv-x', el).addEventListener('click', () => { haptic(); close(); });
}
const Afisha = {
  html: () => {
    if (!EVENTS.length) return `${header(`<button class="pill" data-pick aria-label="Сменить город"><i></i>${esc(cityById(city).name)}<span class="chev">▾</span></button>`)}
      <div class="ahead"><h1 class="d">Афиша</h1></div>
      <div class="empty"><b class="d">Пока пусто</b><p>В этом городе ещё нет запланированных игр.</p>
      </div>${galleryHtml()}`;
    const first = EVENTS[0], last = EVENTS[EVENTS.length - 1];
    const range = first.date.getUTCMonth() === last.date.getUTCMonth()
      ? `${first.date.getUTCDate()} – ${fmtDate(last)}` : `${fmtDate(first)} – ${fmtDate(last)}`;
    const sel = EVENTS.find((e) => e.id === selDay) || first;
    return `
    ${header(`<button class="pill" data-pick aria-label="Сменить город"><i></i>${esc(cityById(city).name)}<span class="chev">▾</span></button>`)}
    <div class="ahead"><h1 class="d">Афиша</h1><div class="range">${range}</div></div>
    <div class="week">${EVENTS.map((e) => `
      <button class="wd ${e.blue ? 'bl' : ''} ${e === sel ? 'on' : ''}" data-day="${esc(e.id)}"><small>${WD[e.dow]}</small><b>${e.date.getUTCDate()}</b></button>`).join('')}
    </div>
    <div id="feat">${feature(sel)}</div>
    <div class="sec"><h3 class="d">Вся неделя</h3></div>
    ${EVENTS.map((e) => `
      <button class="ev ${e.blue ? 'bl' : ''} ${myReg(e) ? 'is-booked' : ''}" data-go="event/${esc(e.id)}">
        <div class="day">${WD_FULL[e.dow]}, ${fmtDate(e)}</div>
        <div class="ttl">${esc(e.type || e.title)}</div>
        <div class="meta"><b>${e.time}</b> ${esc(e.place)}${e.area && !e.blue ? ', ' + esc(e.area) : ''}</div>${myReg(e) ? `<div class="ev-b">${myBadge(myReg(e))}</div>` : ''}
        <span class="go">›</span>
      </button>`).join('')}
    ${galleryHtml()}
    <div class="sec"><h3 class="d">Впервые?</h3></div>
    <button class="ev" data-go="games" style="border-left-color:#fff">
      <div class="ttl">Я никогда не играл в Мафию. Нужно готовиться?</div>
      <div class="meta">Роли, правила и 3 способа вычислить мафию</div><span class="go">›</span>
    </button>`;
  },
  bind: () => {
    $('[data-pick]')?.addEventListener('click', () => { haptic(); openCitySheet(); });
    $$('[data-g]').forEach((b) => b.addEventListener('click', () => { haptic(); openGallery(+b.dataset.g); }));
    $$('[data-ga]').forEach((b) => b.addEventListener('click', () => { const g = $('.gal'); g.scrollBy({ left: +b.dataset.ga * g.clientWidth * 0.8, behavior: 'smooth' }); }));
    if (!EVENTS.length) return;
    $$('[data-day]').forEach((b) => b.addEventListener('click', () => {
      hapticSel(); selDay = b.dataset.day;
      $$('[data-day]').forEach((x) => x.classList.toggle('on', x === b));
      $('#feat').innerHTML = feature(EVENTS.find((e) => e.id === selDay));
      bindFeature();
    }));
    bindFeature();
  },
};
function feature(e) {
  return `
  <div class="feature ${e.blue ? 'bl' : ''}" data-feat="event/${esc(e.id)}">
    ${e.blue ? '' : MASK()}
    <span class="cap tag">${e === EVENTS[0] ? 'Ближайшая игра' : WD_FULL[e.dow]} · ${fmtDate(e)}</span>
    <h2 class="d">${esc(e.title)}</h2>
    <div class="where">${e.time} · ${esc(e.place)} · <b>${priceOf(e)}</b></div>
    <div class="count" data-ts="${e.ts}"><div><b>–</b><span>дн</span></div><div><b>–</b><span>час</span></div><div><b>–</b><span>мин</span></div><div><b>–</b><span>сек</span></div></div>
    ${myReg(e) ? `<div class="feat-booked">${myBadge(myReg(e))}</div>` : `<button class="btn feat-btn" data-book="${esc(e.id)}">Записаться</button>`}
  </div>`;
}
let tick;
function bindFeature() {
  const f = $('.feature');
  f.addEventListener('click', () => { haptic(); go(f.dataset.feat); });
  $('[data-book]', f)?.addEventListener('click', (ev) => {
    ev.stopPropagation(); haptic('medium');
    const e = EVENTS.find((x) => x.id === ev.currentTarget.dataset.book); if (!e) return;
    reg = newReg(e);
    if (e.price === 0) return sendRegistration(e, 1, 'free');
    go(`event/${e.id}`);
  });
  const c = $('.count'), ts = +c.dataset.ts;
  const upd = () => {
    let s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
    const v = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    $$('b', c).forEach((b, i) => (b.textContent = String(v[i]).padStart(2, '0')));
  };
  clearInterval(tick); upd(); tick = setInterval(() => (document.contains(c) ? upd() : clearInterval(tick)), 1000);
}

const EventPage = {
  html: (id) => {
    const e = EVENTS.find((x) => x.id === id) || EVENTS[0];
    if (!e) return `<div class="empty"><b class="d">Мероприятие не найдено</b><p>Возможно, его уже убрали из афиши.</p><button class="btn" data-go="afisha">К афише</button></div>`;
    return `
    <section class="poster ${e.blue ? 'bl' : ''}">
      <div class="num">${String(e.date.getUTCDate()).padStart(2, '0')}</div>
      <span class="cap ${e.blue ? 'blue' : 'red'}">${WD_FULL[e.dow]}, ${fmtDate(e)} · ${e.time}</span>
      <h1 class="d">${esc(e.title)}</h1>
      <p class="lead">${esc(e.desc)}</p>
    </section>
    <div class="facts">
      <div class="fact wide"><span>Где</span><b>${esc(e.place)}</b><div class="mute" style="font-size:13px;margin-top:2px">${esc(e.area)}</div>${e.map ? '<button class="maplink" data-map>Открыть на карте ›</button>' : ''}</div>
      ${gpOf(e) ? `<div class="fact wide"><span>Стоимость</span><b>Мужчины — ${num(gpOf(e).m)} ${gpOf(e).cur}<br>Девушки — ${num(gpOf(e).f)} ${gpOf(e).cur}</b></div>` : `<div class="fact"><span>Стоимость</span><b>${priceTxt(e.price)}</b></div>`}
      ${e.dur ? (() => { const [main, ...rest] = e.dur.split(' · '), note = rest.join(' · '); const long = !note && main.length > 18; return `<div class="fact ${note || long ? 'wide' : ''}"><span>Длительность</span><b class="${long ? 'long' : ''}">${esc(main)}</b>${note ? `<small class="fnote">${esc(note)}</small>` : ''}</div>`; })() : ''}
    </div>
    ${myReg(e) ? `<div class="booked-box">${myBadge(myReg(e))}<p>${myReg(e).k === 'manager' ? 'Менеджер свяжется с вами, чтобы помочь с оплатой.' : 'Ждём вас на игре! Если планы изменились — напишите нам.'}</p></div>` : `
    ${stepperHtml(e, newReg(e))}
    ${e.price || gpOf(e) ? `<div class="total"><span class="mute">Итого</span><b id="sum">${localTotal(e, newReg(e))}</b></div>` : ''}`}
    <button class="btn ghost" style="margin-top:18px" data-go="ask/${esc(e.id)}">Задать вопрос по этой игре</button>`;
  },
  bind: (id) => {
    const e = EVENTS.find((x) => x.id === id) || EVENTS[0];
    $('[data-map]')?.addEventListener('click', () => { haptic(); openLink(e.map); });
    if (!e || myReg(e)) return; // уже записан — кнопки «Записаться» нет
    const r = newReg(e);
    const label = () => `Записаться${r.n > 1 ? ` · ${r.n} чел.` : ''}`;
    bindStepper(r, () => {
      if ($('#sum')) $('#sum').textContent = localTotal(e, r);
      mainButton(label(), submit);
    });
    const submit = () => {
      if (r.n < 1) { notify('warning'); return toast('Укажите, сколько мужчин и девушек'); }
      reg = { ...r };
      if (e.price === 0) return sendRegistration(e, r.n, 'free');   // бесплатно — сразу запись, без оплаты
      go(`pay/${e.id}`);
    };
    mainButton(label(), submit);
  },
};

/* ---------------- запись и оплата ---------------- */
let reg = null;          // { id, n, m?, f? } — мероприятие, число человек (на Бали — мужчины/девушки)
let PAY = null;          // реквизиты, приходят с сервера только в Telegram
let receipt = null;      // прикреплённый чек (File)
let sending = false;
const isoDay = (e) => `${e.date.getUTCFullYear()}-${pad(e.date.getUTCMonth() + 1)}-${pad(e.date.getUTCDate())}`;
const whenTxt = (e) => `${WD_FULL[e.dow]}, ${fmtDate(e)}, ${e.time}`;
const authHdr = () => ({ 'X-Init-Data': tg?.initData || '' });

async function loadPay() {
  if (PAY) return PAY;
  const r = await getJSON(API + '/api/payments', { headers: authHdr() }, 6000);
  if (r.ok && r.j) PAY = r.j;
  return PAY;
}
async function loadQr() {
  try {
    const r = await fetch(API + '/api/payments/qr', { headers: authHdr() });
    return r.ok ? URL.createObjectURL(await r.blob()) : '';
  } catch { return ''; }
}
function copyText(t) {
  const ok = () => { notify('success'); toast('Скопировано'); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(ok, () => legacyCopy(t, ok));
  else legacyCopy(t, ok);
}
function legacyCopy(t, ok) {
  const ta = Object.assign(document.createElement('textarea'), { value: t, style: 'position:fixed;opacity:0' });
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); ok(); } catch { toast('Не удалось скопировать'); }
  ta.remove();
}
// Фото сжимаем до 1600 px (JPEG) — чек остаётся читаемым и быстро отправляется
async function prepReceipt(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 8e6) throw new Error('Файл больше 8 МБ');
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error('Нужна фотография или PDF');
  const asIs = () => { if (file.size > 8e6 || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Фото больше 8 МБ или неподдерживаемый формат'); return file; };
  try {
    const bmp = await Promise.race([
      window.createImageBitmap ? createImageBitmap(file) : new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : asIs();
  } catch { return asIs(); } // не смогли сжать — отправляем как есть, если подходит по формату и размеру
}

async function sendRegistration(e, n, method, comment = '') {
  if (sending) return;
  if (!API_OK || !inTG) { notify('error'); return toast('Запись работает только в Telegram'); }
  if (['thb', 'rub', 'usdt'].includes(method) && !receipt) { notify('error'); return toast('Прикрепите чек об оплате'); }
  sending = true;
  const fd = new FormData();
  fd.append('eventId', e.id); fd.append('date', isoDay(e)); fd.append('count', String(n)); fd.append('method', method);
  if (gpOf(e) && reg?.m !== undefined) { fd.append('men', String(reg.m)); fd.append('women', String(reg.f)); }
  if (comment) fd.append('comment', comment);
  if (receipt && method !== 'manager' && method !== 'free') fd.append('receipt', receipt, receipt.name || 'receipt');
  tg?.MainButton.showProgress?.(); const fb = $('#fbtn'); if (fb) { fb.disabled = true; fb.textContent = 'Отправляем…'; }
  let r;
  try {
    const resp = await fetch(API + '/api/register', { method: 'POST', headers: authHdr(), body: fd });
    r = { ok: resp.ok, j: await resp.json().catch(() => null) };
  } catch { r = { ok: false, j: null }; }
  sending = false;
  tg?.MainButton.hideProgress?.(); if (fb) { fb.disabled = false; fb.textContent = fb.dataset.t || 'Отправить'; }
  if (!r.ok) { notify('error'); return toast(r.j?.error || 'Не удалось отправить. Проверьте интернет и повторите'); }
  notify('success'); receipt = null;
  MY = MY.filter((x) => !(x.e === e.id && x.d === isoDay(e))).concat({ e: e.id, d: isoDay(e), k: r.j.kind === 'manager' ? 'manager' : 'paid', c: false });
  go(`paydone/${e.id}/${r.j.kind}`);
}

// Заявки из форм (вопрос, сотрудничество, заказ игр) — в личку менеджеру выбранного города
async function sendRequest(type, data, title, okMsg, after) {
  if (sending) return;
  if (!API_OK || !inTG) { notify('error'); return toast('Отправка работает только в Telegram'); }
  sending = true;
  tg?.MainButton.showProgress?.(); const fb = $('#fbtn'); if (fb) { fb.disabled = true; fb.textContent = 'Отправляем…'; }
  const r = await getJSON(API + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify({ type, city, ...data }) }, 12000);
  sending = false;
  tg?.MainButton.hideProgress?.(); if (fb) { fb.disabled = false; fb.textContent = fb.dataset.t || 'Отправить'; }
  if (!r.ok) { notify('error'); return toast(r.j?.error || 'Не удалось отправить. Проверьте интернет и повторите'); }
  done(title, okMsg, after);
}

const Pay = {
  html: (arg) => {
    const [id, method] = arg.split('/');
    const e = EVENTS.find((x) => x.id === id);
    if (!e) return `<div class="empty"><b class="d">Мероприятие не найдено</b><button class="btn" data-go="afisha">К афише</button></div>`;
    if (!reg || reg.id !== id) reg = newReg(e);
    return `
    <p class="cap">Запись на игру</p>
    <h1 class="d" style="font-size:40px;margin-top:8px">${esc(e.title)}</h1>
    <p class="mute" style="margin-top:8px;font-size:14px">${whenTxt(e)} · ${esc(e.place)}${reg.n ? ` · ${reg.n} чел.` : ''}</p>
    <div id="paybox"><p class="mute" style="padding:30px 0">Загружаем способы оплаты…</p></div>`;
  },
  bind: async (arg) => {
    const [id, method] = arg.split('/');
    const e = EVENTS.find((x) => x.id === id); if (!e) return;
    const box = $('#paybox'), n = reg.n;
    const pay = await loadPay();
    if (!document.contains(box)) return;
    const thb = payTotal(e, reg, pay, 'thb'), rub = payTotal(e, reg, pay, 'rub'), usdt = payTotal(e, reg, pay, 'usdt');

    // шаг 1 — выбор способа
    if (!method) {
      receipt = null;
      const m = [
        thb && ['thb', '🇹🇭', 'Тайский счёт', `${thb} · QR PromptPay`],
        rub && ['rub', '🇷🇺', 'Российский счёт', `${rub} · перевод на карту`],
        usdt && ['usdt', '₮', 'Криптовалюта', `${usdt} · ${esc(pay.usdt.network || 'TRC-20')}`],
        ['manager', '💬', 'Нет такого способа', 'Связаться с менеджером'],
      ].filter(Boolean);
      if (reg.n < 1) { box.innerHTML = `<p class="mute" style="padding:30px 0">Сначала укажите, сколько вас.</p><button class="btn" id="toev">К игре</button>`; $("#toev").onclick = () => go(`event/${id}`); return; }
      box.innerHTML = `
        <div class="sec" style="margin-top:22px"><h3 class="d">Способ оплаты</h3></div>
        ${gpOf(e) ? '<p class="hint" style="margin:-6px 0 12px">Оплата в местной валюте скоро появится. Пока можно оплатить в рублях или криптовалютой.</p>' : ''}
        <div class="pms">${m.map(([k, ic, t, s]) => `<button class="pm ${k === 'manager' ? 'alt' : ''}" data-pm="${k}"><span class="ic">${ic}</span><div><b>${t}</b><small>${s}</small></div><span class="go">›</span></button>`).join('')}</div>
        ${pay ? '' : '<p class="hint" style="margin-top:12px">Реквизиты недоступны. Откройте приложение из Telegram.</p>'}`;
      $$('[data-pm]').forEach((b) => b.addEventListener('click', () => {
        if (reg.n < 1) { notify('warning'); return toast('Укажите, сколько мужчин и девушек'); }
        haptic(); go(`pay/${id}/${b.dataset.pm}`);
      }));
      return;
    }

    // шаг 2 — реквизиты и чек
    if (reg.n < 1) { box.innerHTML = `<p class="mute" style="padding:30px 0">Сначала укажите, сколько вас.</p><button class="btn" id="toev">К игре</button>`; $("#toev").onclick = () => go(`event/${id}`); return; }
    if (method === 'manager') {
      box.innerHTML = `<div class="sec" style="margin-top:22px"><h3 class="d">Связаться с менеджером</h3></div>
        <p class="lead" style="font-size:14px">Заявка уйдёт менеджеру с пометкой «нет возможности оплатить». Он свяжется с вами и подскажет, как оплатить.</p>
        <div class="field"><label>Комментарий (необязательно)</label><textarea class="inp" id="pm-note" maxlength="300" placeholder="Например: «Живу в другой стране, удобнее оплатить картой»"></textarea></div>`;
      mainButton('Отправить заявку менеджеру', () => sendRegistration(e, n, 'manager', $('#pm-note').value.trim()));
      return;
    }
    const amount = method === 'thb' ? thb : method === 'rub' ? rub : usdt;
    if ((method === 'thb' && !thb) || (method === 'rub' && !rub) || (method === 'usdt' && !usdt)) { box.innerHTML = '<p class="mute">Способ недоступен.</p>'; return; }
    let details = '';
    if (method === 'thb') details = `<div class="qrbox" id="qrbox">${pay?.qr ? '<span class="mute">Загружаем QR…</span>' : '<span class="mute">QR недоступен</span>'}</div><p class="hint" style="text-align:center">Откройте банковское приложение → «Сканировать QR» → оплатите сумму выше.</p>`;
    if (method === 'rub') details = `<div class="copyrow"><div><span>Номер карты</span><b>${esc(pay.rub.card)}</b></div><button data-copy="${esc(String(pay.rub.card).replace(/\s/g, ''))}">Копировать</button></div>
      <div class="copyrow"><div><span>Получатель</span><b>${esc(pay.rub.holder || '')}</b></div></div>`;
    if (method === 'usdt') details = `<div class="copyrow"><div><span>Сеть</span><b>${esc(pay.usdt.network || 'TRC-20')}</b></div></div>
      <div class="copyrow"><div><span>Адрес кошелька</span><b class="mono">${esc(pay.usdt.address)}</b></div><button data-copy="${esc(pay.usdt.address)}">Копировать</button></div>
      <p class="hint">Отправляйте только USDT в сети TRC-20, иначе средства потеряются.</p>`;
    box.innerHTML = `<div class="sec" style="margin-top:22px"><h3 class="d">${method === 'thb' ? 'Тайский счёт' : method === 'rub' ? 'Российский счёт' : 'Криптовалюта'}</h3></div>
      <div class="amount"><span>К оплате</span><b>${amount}</b></div>
      ${details}
      <div class="sec" style="margin-top:26px"><h3 class="d">Чек об оплате</h3></div>
      <label class="attach" id="attach"><input type="file" id="rc" accept="image/*,application/pdf"><span class="ico">📎</span><div><b id="rc-t">Прикрепить чек</b><small id="rc-s">Фото, скриншот или PDF</small></div></label>
      <img id="rc-img" class="rcimg" alt="" hidden>`;
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
    if (method === 'thb' && pay?.qr) loadQr().then((u) => { const q = $('#qrbox'); if (q) q.innerHTML = u ? `<img src="${u}" alt="QR для оплаты">` : '<span class="mute">Не удалось загрузить QR</span>'; });
    $('#rc').addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        receipt = await prepReceipt(f); hapticSel();
        $('#rc-t').textContent = 'Чек прикреплён ✓'; $('#rc-s').textContent = `${receipt.name} · ${(receipt.size / 1024).toFixed(0)} КБ · нажмите, чтобы заменить`;
        $('#attach').classList.add('ok');
        const im = $('#rc-img'); if (receipt.type.startsWith('image/')) { im.src = URL.createObjectURL(receipt); im.hidden = false; } else im.hidden = true;
      } catch (err) { receipt = null; notify('error'); toast(err.message || 'Не удалось прочитать файл'); }
    });
    mainButton('Отправить', () => sendRegistration(e, n, method));
  },
};

const PayDone = {
  html: (arg) => {
    const [id, kind] = arg.split('/');
    const e = EVENTS.find((x) => x.id === id);
    const paid = kind !== 'manager';
    return `
    <section class="done">
      <div class="tick">${paid ? '✓' : '✉'}</div>
      <h1 class="d">${paid ? 'Вы записаны<br><span class="red">на игру</span>' : 'Заявка<br><span class="red">отправлена</span>'}</h1>
      <p class="lead">${paid ? 'Хорошего дня и до встречи!' : 'Менеджер свяжется с вами в ближайшее время.'}</p>
      ${e ? `<div class="ticket"><span class="cap">${esc(e.title)}</span><b class="d">${whenTxt(e)}</b><p>${esc(e.place)}${e.area ? ', ' + esc(e.area) : ''}</p><p>${peopleTxt(reg)}</p></div>` : ''}
      ${e && aboutOf(e.city).tg ? `<div class="chat-cta"><b>Вступайте в наш чат</b>
        <button class="btn" data-chat>${SOC_ICON.tg}Вступить в чат</button></div>` : ''}
      <button class="btn ${e && aboutOf(e.city).tg ? 'ghost' : ''}" data-go="afisha" style="margin-top:10px">В афишу</button>
    </section>`;
  },
  bind: (arg) => {
    stack.length = 0; receipt = null;
    const e = EVENTS.find((x) => x.id === arg.split('/')[0]);
    $('[data-chat]')?.addEventListener('click', () => { haptic(); openTgLink(aboutOf(e.city).tg); });
  },
};

const Games = {
  html: () => `
  ${header()}
  <p class="cap">Всё, что нужно знать перед игрой</p>
  <h1 class="d big" style="margin-top:10px">Правила<br><span class="red">мафии</span></h1>
  <nav class="subnav" id="subnav">
    ${[['goal', 'Цель'], ['flow', 'Ход игры'], ['roles', 'Роли'], ['gest', 'Жесты'], ['rules', 'Важно'], ['strike', 'Страйки']]
      .map(([id, t], i) => `<button data-to="${id}" class="${i ? '' : 'on'}">${t}</button>`).join('')}
  </nav>

  <section id="goal" class="anchor">
    <div class="sec"><h3 class="d">Цель <span class="red">игры</span></h3></div>
    <div class="teams">
      <div class="team-c black"><span class="cap red">Мафия</span><b class="d">Знают друг друга</b><p>Устраняют игроков по ночам. Побеждают, если остаются в большинстве либо при равном количестве Мирных и Мафии.</p></div>
      <div class="team-c"><span class="cap">Мирные жители</span><b class="d">Не знают никого</b><p>Пытаются вычислить Мафию. Побеждают, если устраняют всех мафиози.</p></div>
    </div>
  </section>

  <section id="flow" class="anchor">
    <div class="sec"><h3 class="d">В игре <span class="red">две фазы</span></h3></div>
    <div class="phases">${PHASES.map(([t, d], i) => `<div class="phase"><span class="em">${i ? '☀️' : '🌙'}</span><div><b class="red">${t}</b><p>${d}</p></div></div>`).join('')}</div>
    <div class="sec" style="margin-top:22px"><h3 class="d">Ход игры <span class="red">днём</span></h3></div>
    <div class="steps">
      ${DAY.map(([t, d, x], i) => `<div class="step"><span class="n">${i + 1}</span><div><b>${t}</b><p>${d}${x ? ` · <span class="red">${x}</span>` : ''}</p></div></div>`).join('')}
    </div>
  </section>

  <section id="roles" class="anchor">
    <div class="sec"><h3 class="d">Роли</h3><span class="cap">${ROLES.length} ролей</span></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 14px">Добавляются по мере увеличения количества игроков. Нажми на карту.</p>
    <div class="rgrid">${ROLES.map((r) => `
      <button class="rcard" data-role="${r.id}" aria-label="${r.n}">${roleIcon(r)}</button>`).join('')}
    </div>
    <div class="jargon">
      <div><i class="dot r"></i><div><b>Красные игроки</b><p>Роли мирного города: Мирный житель, Шериф, Доктор, Детектив, Любовница.</p></div></div>
      <div><i class="dot b"></i><div><b>Чёрные игроки</b><p>Роли с возможностью выстрела: Мафия, Дон Мафии, Хитман и Оборотень после перевоплощения.</p></div></div>
    </div>
  </section>

  <section id="gest" class="anchor">
    <div class="sec"><h3 class="d">Жесты <span class="red">ведущего</span></h3></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 12px">Ночью ведущий показывает результаты проверок жестами.</p>
    <div class="gest">${GESTURES.map(([e, t, d]) => `<div><span class="em">${e}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
  </section>

  <section id="rules" class="anchor">
    <div class="sec"><h3 class="d red">Важно!</h3></div>
    <div class="closed"><b>Играем в закрытую мафию</b><p>Не показывайте свою карту с ролью другим игрокам и не обсуждайте её внешний вид, даже если вы выбыли из игры. Говорить можете всё, что угодно.</p></div>
    <div class="sec" style="margin-top:22px"><h3 class="d">Общие <span class="red">правила</span></h3></div>
    <ol class="rules">${RULES.map((r) => `<li>${r}</li>`).join('')}</ol>
  </section>

  <section id="strike" class="anchor">
    <div class="sec"><h3 class="d">Страйки</h3></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 10px">Страйк дают:</p>
    <ul class="sfor">${STRIKE_FOR.map((x) => `<li>${x}</li>`).join('')}</ul>
    <p class="mute" style="font-size:13px;margin:14px 0 10px">Всего за игру можно получить 4 страйка.</p>
    <div class="strikes">${STRIKES.map(([t, d], i) => `
      <button class="strk" style="--k:${(i + 1) / 4}"><span class="lvl">${i + 1}</span><div><b>${t}</b>${d ? `<p>${d}</p>` : ''}</div></button>`).join('')}
    </div>
  </section>

  <div class="sec"><h3 class="d">3 способа вычислить <span class="red">мафию</span></h3></div>
  <div class="tips">
    <div class="tip"><span class="n">1</span><div><b>Следи за реакциями</b><p>Мимика и жесты говорят больше слов.</p></div></div>
    <div class="tip"><span class="n">2</span><div><b>Оценивай логику</b><p>Проверь, нет ли противоречий в словах игрока.</p></div></div>
    <div class="tip"><span class="n">3</span><div><b>Сравнивай поведение</b><p>Слова могут меняться, поведение — реже.</p></div></div>
  </div>
  <p class="cap" style="margin-top:14px"><span class="dash"></span>&nbsp; Это умеет каждый, даже на первой игре</p>
  <button class="btn" style="margin-top:26px" data-go="afisha">Выбрать игру в афише</button>`,
  bind: () => {
    $$('[data-role]').forEach((b) => b.addEventListener('click', () => { haptic('medium'); openRole(b.dataset.role); }));
    $$('[data-to]').forEach((b) => b.addEventListener('click', () => {
      hapticSel();
      $('#' + b.dataset.to).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // подсветка текущего раздела в подменю
    const btns = $$('[data-to]');
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      btns.forEach((b) => b.classList.toggle('on', b.dataset.to === e.target.id));
      $(`[data-to="${e.target.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }), { rootMargin: '-30% 0px -60% 0px' });
    $$('.anchor').forEach((s) => io.observe(s));
  },
};

// Выбор города — выезжающая снизу панель (по нажатию на название города в шапке афиши)
function openCitySheet() {
  sheetClose?.(true);
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `
    <div class="sheet" role="dialog">
      <i class="grab"></i><button class="x" aria-label="Закрыть">✕</button>
      <div class="role-h"><span class="cap">Где вы сейчас?</span><h2 class="d">Выберите <span class="red">город</span></h2></div>
      <div class="pms" style="margin-top:16px">${CFG.cities.map((c) => `
        <button class="pm ${c.id === city ? 'cur' : ''}" data-pc="${esc(c.id)}"><span class="ic">${c.status === 'active' ? '📍' : '⏳'}</span>
          <div><b>${esc(c.name)}</b>${c.status === 'active' ? '' : '<small>скоро открытие</small>'}</div>
          ${c.id === city ? '<span class="go" style="color:var(--red)">✓</span>' : ''}</button>`).join('')}
      </div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const close = (instant) => {
    sheetClose = null;
    if (instant) return el.remove();
    el.classList.remove('on'); setTimeout(() => el.remove(), 300);
    if (inTG && TABS.includes(cur.split('/')[0])) tg.BackButton.hide();
  };
  sheetClose = close;
  if (inTG) tg.BackButton.show();
  el.addEventListener('click', (e) => { if (e.target === el) { haptic(); close(); } });
  $('.x', el).addEventListener('click', () => { haptic(); close(); });
  $$('[data-pc]', el).forEach((b) => b.addEventListener('click', () => {
    haptic('medium');
    const id = b.dataset.pc;
    close(true);
    if (id === city) { if (inTG && TABS.includes(cur.split('/')[0])) tg.BackButton.hide(); return; }
    city = id; store.set(CITY_KEY, id); selDay = null;
    go(home());
  }));
}

// Карточка роли — выезжающая снизу панель
let sheetClose = null;
function openRole(id) {
  const i = ROLES.findIndex((r) => r.id === id);
  const r = ROLES[i];
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `
    <div class="sheet" role="dialog">
      <i class="grab"></i><button class="x" aria-label="Закрыть">✕</button>
      <div class="role-h"><span class="cap ${r.side === 'black' ? 'red' : ''}">${r.team}</span><h2 class="d">Роль: <span class="red">${r.n}</span></h2></div>
      <div class="role-b">
        <div class="frame">${roleIcon(r)}</div>
        <div class="role-t">${r.t.map((p) => `<p>${p}</p>`).join('')}</div>
      </div>
      <p class="role-tip">${r.tip}</p>
      <div class="role-nav">
        <button data-nav="-1" ${i ? '' : 'disabled'}>← ${ROLES[i - 1]?.n || ''}</button>
        <button data-nav="1" ${ROLES[i + 1] ? '' : 'disabled'}>${ROLES[i + 1]?.n || ''} →</button>
      </div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const close = (instant) => {
    sheetClose = null;
    if (instant) return el.remove();
    el.classList.remove('on'); setTimeout(() => el.remove(), 300);
    if (inTG && TABS.includes(cur.split('/')[0])) tg.BackButton.hide();
  };
  sheetClose = close;
  if (inTG) tg.BackButton.show();
  el.addEventListener('click', (e) => { if (e.target === el) { haptic(); close(); } });
  $('.x', el).addEventListener('click', () => { haptic(); close(); });
  $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => {
    const next = ROLES[i + +b.dataset.nav]; if (!next) return;
    hapticSel(); close(true); openRole(next.id); $('.sheet-wrap').classList.add('on', 'noanim');
  }));
  // свайп вниз — закрыть
  const sh = $('.sheet', el); let y0 = null;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', (e) => {
    if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; sh.style.transform = '';
    if (dy > 90) { haptic(); close(); }
  });
}

const order = { fmts: new Set(['Мафия']), guests: 15, lang: 'RU', date: '', contact: '', note: '' };
const Order = {
  html: () => `
  ${header()}
  <p class="cap">Частные события под ключ</p>
  <h1 class="d big" style="margin-top:10px">Игры на<br><span class="red">ваш праздник</span></h1>
  <p class="lead" style="margin-top:12px">День рождения, корпоратив, вечеринка. Профессиональные ведущие, маски, карточки ролей — в любой точке острова.</p>
  <div class="field" style="margin-top:26px"><label>Что проводим<b id="fcount"></b></label>
    <div class="formats" style="margin-top:0">${FORMATS.map((f) => `
      <button class="fmt ${order.fmts.has(f.n) ? 'on' : ''}" data-f="${f.n}"><span class="d">${f.n}</span><small>${f.s}</small></button>`).join('')}</div></div>
  <button class="custom-btn" data-go="custom"><span class="ic">✨</span><div><b>Своё мероприятие</b><small>Опишите свои предпочтения по мероприятию — менеджер сразу с вами свяжется</small></div><span class="go">›</span></button>
  <div class="field"><label>Гостей<b id="gv">${order.guests}</b></label><input type="range" id="guests" min="5" max="60" step="1" value="${order.guests}"></div>
  <div class="field"><label>Язык игры</label><div class="seg">${['RU', 'EN'].map((l) => `<button data-l="${l}" class="${order.lang === l ? 'on' : ''}">${l === 'RU' ? 'Русский' : 'English'}</button>`).join('')}</div></div>
  <div class="field"><label>Дата и контакты</label>
    <input class="inp" type="date" id="odate" value="${order.date}">
    <input class="inp" id="ocontact" placeholder="Телефон или @username" value="${esc(order.contact || tgUser('contact'))}">
    <textarea class="inp" id="onote" placeholder="Пару слов о мероприятии">${esc(order.note)}</textarea></div>`,
  bind: () => {
    const fc = () => { $('#fcount').textContent = order.fmts.size ? `${order.fmts.size} выбрано` : ''; };
    fc();
    $$('[data-f]').forEach((b) => b.addEventListener('click', () => {
      hapticSel(); const f = b.dataset.f;
      order.fmts.has(f) ? order.fmts.delete(f) : order.fmts.add(f);
      b.classList.toggle('on'); fc();
    }));
    const g = $('#guests');
    const paint = () => { g.style.setProperty('--p', ((g.value - g.min) / (g.max - g.min)) * 100 + '%'); $('#gv').textContent = g.value + (g.value == 60 ? '+' : ''); };
    paint();
    g.addEventListener('input', () => { order.guests = +g.value; paint(); if (g.value % 5 === 0) hapticSel(); });
    $$('[data-l]').forEach((b) => b.addEventListener('click', () => { hapticSel(); order.lang = b.dataset.l; $$('[data-l]').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#odate').min = new Date().toISOString().slice(0, 10);
    [['odate', 'date'], ['ocontact', 'contact'], ['onote', 'note']].forEach(([id, k]) => $('#' + id).addEventListener('input', (e) => (order[k] = e.target.value)));
    mainButton('Отправить заявку', () => {
      if (!order.fmts.size) { notify('error'); return toast('Выберите хотя бы одну игру'); }
      if (!$('#ocontact').value.trim()) { notify('error'); $('#ocontact').focus(); return toast('Оставьте контакт для связи'); }
      sendRequest('order', { contact: $('#ocontact').value.trim(), name: tgUser('name'), formats: [...order.fmts], guests: order.guests, lang: order.lang, date: order.date, message: order.note.trim() },
        'Заявка принята', `${[...order.fmts].join(', ')} · ${order.guests} гостей · ${order.lang}. Менеджер свяжется с вами в ближайшее время.`, () => { order.date = order.note = ''; route(); });
    });
  },
};

const Custom = {
  html: () => `
  ${header()}
  <p class="cap">Индивидуальный формат</p>
  <h1 class="d big" style="margin-top:10px">Своё<br><span class="red">мероприятие</span></h1>
  <p class="lead" style="margin-top:12px">Расскажите, что вы задумали: повод, формат игр, пожелания. Заявка сразу уйдёт менеджеру, и он свяжется с вами.</p>
  <div class="field"><label>Опишите мероприятие</label><textarea class="inp" id="cu-desc" rows="6" maxlength="1500" placeholder="Например: день рождения на вилле, 20 гостей, хотим Мафию и квиз, ведущий на русском"></textarea></div>
  <div class="field"><label>Когда и сколько гостей</label>
    <input class="inp" type="date" id="cu-date">
    <input class="inp" type="number" id="cu-guests" min="1" max="1000" inputmode="numeric" placeholder="Количество гостей"></div>
  <div class="field"><label>Как с вами связаться</label>
    <input class="inp" id="fn" placeholder="Имя" value="${esc(tgUser('name'))}">
    <input class="inp" id="fc" placeholder="Телефон или @username" value="${esc(tgUser('contact'))}"></div>`,
  bind: () => {
    $('#cu-date').min = new Date().toISOString().slice(0, 10);
    mainButton('Отправить менеджеру', () => {
      const desc = $('#cu-desc').value.trim(), contact = $('#fc').value.trim();
      if (!desc) { notify('error'); $('#cu-desc').focus(); return toast('Опишите мероприятие'); }
      if (!contact) { notify('error'); $('#fc').focus(); return toast('Оставьте контакт для связи'); }
      sendRequest('custom', { name: $('#fn').value.trim(), contact, message: desc, date: $('#cu-date').value, guests: $('#cu-guests').value }, 'Заявка принята', 'Менеджер свяжется с вами в ближайшее время.');
    });
  },
};

const Club = {
  html: () => {
    const weekly = EVENTS.filter((x) => x.repeat !== 'once').length, ab = aboutOf(city);
    const stats = [ab.members ? [esc(ab.members), 'участников'] : null, weekly ? [String(weekly), 'игр в неделю'] : null].filter(Boolean);
    const socials = [['tg', 'Чат в Telegram'], ['ig', 'Instagram'], ['wa', 'WhatsApp'], ['site', 'Сайт']].filter(([k]) => ab[k]);
    return `
  ${header()}
  <h1 class="d big">Game<br><span class="red">Phuket</span></h1>
  ${ab.lead ? `<p class="lead" style="margin-top:12px">${esc(ab.lead)}</p>` : ''}
  ${stats.length ? `<div class="stats" style="grid-template-columns:repeat(${stats.length},1fr)">` : '<div hidden>'}${stats.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('')}</div>
  <div class="links">
    ${socials.map(([k, t]) => `<button class="lnk" data-soc="${k}"><div><b>${t}</b><small>${esc(handleOf(ab[k], k))}</small></div><span>↗</span></button>`).join('')}
    <button class="lnk" data-go="coop"><div><b>Сотрудничество</b><small>Площадки, бренды, партнёры</small></div><span>→</span></button>
    <button class="lnk" data-go="ask"><div><b>Задать вопрос</b><small>Ответим в ближайшее время</small></div><span>→</span></button>
    <button class="lnk" data-city="reset"><div><b>Сменить город</b><small>Сейчас: ${esc(cityById(city)?.name || '')}</small></div><span>→</span></button>
  </div>
  <p class="cap" style="text-align:center;margin-top:30px">${sparks()}</p>`;
  },
  bind: () => {
    $$('[data-soc]').forEach((b) => b.addEventListener('click', () => { haptic(); openAny(aboutOf(city)[b.dataset.soc]); }));
    $('[data-city=reset]').onclick = resetCity;
  },
};

function formScreen(type, cap, title, red, lead, ph, ok) {
  return {
    html: (arg) => {
      const e = type === 'ask' && arg ? EVENTS.find((x) => x.id === arg) : null;
      return `
    ${header()}
    <p class="cap">${cap}</p>
    <h1 class="d big" style="margin-top:10px">${title}<br><span class="red">${red}</span></h1>
    <p class="lead" style="margin-top:12px">${lead}</p>
    <div class="field"><label>Как к вам обращаться</label>
      <input class="inp" id="fn" placeholder="Имя" value="${tgUser('name')}">
      <input class="inp" id="fc" placeholder="Телефон или @username" value="${tgUser('contact')}"></div>
    ${e ? `<div class="about-game"><span class="cap">Вопрос по игре</span><b class="d">${esc(e.title)}</b><small>${WD_FULL[e.dow]}, ${fmtDate(e)} · ${e.time} · ${esc(e.place)}</small></div>` : ''}
    <div class="field"><label>Сообщение</label><textarea class="inp" id="fm" placeholder="${ph}"></textarea></div>`;
    },
    bind: (arg) => mainButton('Отправить', () => {
      if (!$('#fc').value.trim() || !$('#fm').value.trim()) { notify('error'); return toast('Заполните контакт и сообщение'); }
      const e = type === 'ask' && arg ? EVENTS.find((x) => x.id === arg) : null;
      sendRequest(type, { name: $('#fn').value.trim(), contact: $('#fc').value.trim(), message: $('#fm').value.trim(), ...(e ? { eventId: e.id, date: isoDay(e) } : {}) }, 'Отправлено', ok);
    }),
  };
}
const Ask = formScreen('ask', 'Есть вопрос?', 'Напишите', 'нам', 'Про игры, запись или частное мероприятие — ответим лично.', 'Ваш вопрос', 'Менеджер ответит вам в ближайшее время.');
const Coop = formScreen('coop', 'Для площадок и брендов', 'Давайте', 'дружить', 'Мы организуем и проводим развлекательные игры на острове и всегда открыты к взаимовыгодному сотрудничеству.', 'Как вы видите наше сотрудничество?', 'Менеджер свяжется с вами и договорится о встрече.');

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function tgUser(k) {
  const u = tg?.initDataUnsafe?.user;
  if (!u) return '';
  return k === 'name' ? [u.first_name, u.last_name].filter(Boolean).join(' ') : u.username ? '@' + u.username : '';
}

/* ---------------- старт ---------------- */
(async () => {
  if (tg) {
    if (/^(ios|android|android_x)$/.test(tg.platform)) document.documentElement.dataset.mobile = '1';
    tg.ready(); tg.expand();
    // Полноэкранный режим (Bot API 8.0+): на телефонах прячет шапку Telegram.
    // Отступы сверху берутся из --tg-safe-area / --tg-content-safe-area (кнопки «Закрыть» и «⋯» поверх контента).
    if (tg.isVersionAtLeast?.('8.0') && /^(ios|android|android_x)$/.test(tg.platform) && !tg.isFullscreen) {
      try { tg.requestFullscreen(); } catch {}
    }
    tg.setHeaderColor?.('#000000'); tg.setBackgroundColor?.('#000000'); tg.setBottomBarColor?.('#000000');
    tg.disableVerticalSwipes?.();
    tg.BackButton.onClick(back);
  }
  // убираем служебный #tgWebAppData=… из адреса (telegram-web-app.js уже прочитал его при загрузке)
  if (/tgWebApp/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  city = await store.get(CITY_KEY);
  await loadConfig();
  if (!cityById(city)) city = ''; // сохранённый город мог быть удалён
  if (inTG && tg.CloudStorage && tg.isVersionAtLeast?.('6.9')) try { tg.CloudStorage.removeItem('city'); } catch {} // старое облачное сохранение
  route();
})();
