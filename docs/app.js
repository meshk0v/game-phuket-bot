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
let CFG = { cities: [], events: [] }, REV = 0, API_OK = false, IS_ADMIN = false;
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
  if (r.ok && r.j?.config?.cities) { CFG = r.j.config; REV = r.j.rev; API_OK = true; ls.set('gp_cfg', JSON.stringify(CFG)); }
  else {
    try { CFG = JSON.parse(ls.get('gp_cfg')); } catch {}               // последняя удачная копия с сервера
    if (!CFG?.cities?.length) CFG = (await getJSON('default-config.json')).j || { cities: [], events: [] }; // встроенная афиша
  }
  if (inTG && API_OK) IS_ADMIN = !!(await getJSON(API + '/api/me', { method: 'POST', headers: { 'X-Init-Data': tg.initData } })).j?.isAdmin;
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
const fmtDate = (e) => `${e.date.getUTCDate()} ${MON[e.date.getUTCMonth()]}`;
const priceTxt = (p) => (p === 0 ? 'Бесплатно' : p === null || p === undefined || p === '' ? 'Уточняйте' : `${p} ฿`);

// Тексты ролей и правил — из сторис Game Phuket «Роли в мафии»
const ROLES = [
  { id: 'civ', n: 'Мирный', side: 'red', team: 'Красный · мирный город', ico: 'cap',
    t: ['Твоя задача — вычислить мафию по словам и поведению и убедить стол голосовать правильно.', 'Мирные выигрывают, когда думают сообща.'],
    tip: 'Слушай. Анализируй. Вычисли мафию.' },
  { id: 'maf', n: 'Мафия', side: 'black', team: 'Чёрный · мафия', ico: 'gang',
    t: ['Ночью ты в деле, днём — мирный.', 'Твоя сила в том, что мафия знает друг друга, а город — нет.', 'Задача проста и сложна одновременно: убирать мирных и не попасться, когда весь стол ищет виноватого.'],
    tip: 'Будь убедительным. Не вызывай подозрений.' },
  { id: 'don', n: 'Дон мафии', side: 'black', team: 'Мафия', ico: 'don',
    t: ['Имеет решающий голос: если Мафия не может определиться, кого убивать, решает Дон.', 'Просыпается отдельно, чтобы найти Шерифа, — проверяет игроков ночью. Если он нашёл Шерифа, ведущий покажет знак 👌.'],
    tip: 'Каждую ночь ищешь Шерифа отдельно от остальных.' },
  { id: 'sher', n: 'Шериф', side: 'red', team: 'Красный · мирный город', ico: 'sheriff',
    t: ['Ночью ты проверяешь игрока и узнаёшь правду: свой он или мафия.', '👍 Большой палец вверх — это мирный, оборотень до перевоплощения и хитман (Хитман всегда показывается шерифу красным).', '👎 Большой палец вниз — это мафия, Дон мафии или оборотень после перевоплощения.'],
    tip: 'Узнай правду. Дождись момента. Назови мафию.' },
  { id: 'doc', n: 'Доктор', side: 'red', team: 'Красный · мирный город', ico: 'doctor',
    t: ['Каждую ночь выбирает одного игрока для лечения.', 'Может лечить себя один раз за всю игру, не может лечить одного и того же игрока два раза подряд.'],
    tip: 'Не спасает от двух убийств (если в одного и того же игрока стреляли и мафия, и хитман).' },
  { id: 'det', n: 'Детектив', side: 'red', team: 'Красный · мирный город', ico: 'detective',
    t: ['Каждую ночь проверяет одного игрока на наличие роли.', '👍 Большой палец вверх — это обычный Мирный житель без роли.', '👉 Большой палец вбок — у игрока любая активная роль, как положительная, так и отрицательная.'],
    tip: 'Детектив — единственный, кто своей проверкой может найти Хитмана.' },
  { id: 'put', n: 'Путана', side: '', team: 'Активная роль', ico: 'hair',
    t: ['Выбирает игрока, которого «забирает к себе домой», тем самым спасает его от смерти.', 'Если в эту ночь был произведён выстрел в Путану, умирают и Путана, и тот игрок, который находился у неё.'],
    tip: 'Не светись. Спасая другого, рискуешь собой.' },
  { id: 'hit', n: 'Хитман', side: 'black', team: 'Чёрный · сам за себя', ico: 'hitman',
    t: ['Играет сам за себя, убивает по ночам, может убить Мафию.', 'Должен остаться один на один с любым из игроков.'],
    tip: 'Подсказка: Хитману выгоднее искать и убивать мафию вместе с мирным городом, чтобы мафия ночью не убила его.' },
  { id: 'wolf', n: 'Оборотень', side: 'red', team: 'Красный, пока не обернулся', ico: 'wolf',
    t: ['Изначально играет за мирный город и не знаком с мафией, но каждую ночь просыпается отдельно от всех.', 'В ту ночь, когда ведущий покажет ему 👎 большой палец вниз, он перевоплощается в Мафию — с этого момента просыпается вместе с ней и совершает убийства.'],
    tip: 'Будь готов к перемене в любую ночь.' },
];
const GESTURES = [
  ['👍', 'Большой палец вверх', 'Шерифу — «красный» игрок. Детективу — мирный без роли. Оборотню — ещё не обращается.'],
  ['👎', 'Большой палец вниз', 'Шерифу — мафия, Дон или обернувшийся оборотень. Оборотню — становится Мафией.'],
  ['👉', 'Большой палец вбок', 'Для Детектива: у игрока есть активная роль.'],
  ['👌', 'Знак «ок»', 'Для Дона: он нашёл Шерифа.'],
];
const RULES = [
  'Не показывайте свою карту с ролью другим игрокам и не обсуждайте её внешний вид, даже если вы выбыли из игры.',
  'Говорить можете всё, что угодно. Карточку вы смотрите только один раз за игру.',
  'Во время ночной фазы все игроки молчат, запрещены любые жесты, пока на вашем лице есть маска.',
  'Мёртвые игроки молчат и игнорируют любые вопросы.',
  'Всё, что происходит в игре, остаётся в игре. Клятвы и обещания будут наказаны страйком.',
  'Во время ночной фазы озвучиваются все роли, независимо от того, выбыл ли персонаж из игры или остался в ней.',
];
const STRIKES = [
  ['Предупредительный', ''],
  ['Без голоса', 'Игрок лишается права голоса на ближайшем голосовании.'],
  ['Молчание', 'Игрок не может общаться с игроками, пока не решит головоломку от ведущего.'],
  ['Удаление', 'Удаление с игры.'],
];

// Красные силуэты ролей (в стиле карточек из сторис)
const BODY = '<circle cx="50" cy="44" r="16"/><path d="M14 100c0-22 15-33 36-33s36 11 36 33z"/>';
const ICONS = {
  cap: `${BODY}<path d="M32 38q1-19 18-19t18 19z"/><path d="M29 38h44q-2 6-11 6H35q-6 0-6-6z"/>`,
  gang: `<g opacity=".75" transform="translate(-24 10) scale(.8)">${BODY}<path d="M30 33l3-17q17-7 34 0l3 17z"/><ellipse cx="50" cy="33" rx="29" ry="5"/></g><g opacity=".75" transform="translate(44 10) scale(.8)">${BODY}<path d="M30 33l3-17q17-7 34 0l3 17z"/><ellipse cx="50" cy="33" rx="29" ry="5"/></g>${BODY}<path d="M30 33l3-17q17-7 34 0l3 17z"/><ellipse cx="50" cy="33" rx="29" ry="5"/><path d="M50 68l-4 6 4 24 4-24z" fill="#000"/>`,
  don: `${BODY}<path d="M30 33l3-17q17-7 34 0l3 17z"/><ellipse cx="50" cy="33" rx="30" ry="5"/><path d="M36 67l14 14 14-14" fill="none" stroke="#000" stroke-width="3"/><path d="M50 70l-4 6 4 22 4-22z" fill="#000"/>`,
  sheriff: `${BODY}<path d="M16 33q34 10 68 0-4 8-34 9-30-1-34-9z"/><path d="M35 34q-2-19 8-19l7 6 7-6q10 0 8 19z"/><path d="M62 78l2.5 5 5.5.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z" fill="#000"/>`,
  doctor: `${BODY}<circle cx="50" cy="31" r="7" fill="#000"/><circle cx="50" cy="31" r="3.5"/><path d="M57 80h10M62 75v10" stroke="#000" stroke-width="3.5"/><path d="M38 68q-4 16 6 20" fill="none" stroke="#000" stroke-width="2"/>`,
  detective: `${BODY}<path d="M31 38q0-21 19-21t19 21z"/><path d="M28 38h46q-3 5-10 5H34q-5 0-6-5z"/><circle cx="20" cy="62" r="11" fill="none" stroke="currentColor" stroke-width="4"/><path d="M27 70l9 12" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
  hair: `<path d="M29 46q-2-27 21-27t21 27q4 24-8 28H37q-12-4-8-28z"/>${BODY}<path d="M38 72q12 8 24 0" fill="none" stroke="#000" stroke-width="2"/>`,
  hitman: `${BODY}<path d="M30 33l3-17q17-7 34 0l3 17z"/><ellipse cx="50" cy="33" rx="29" ry="5"/><path d="M50 68l-4 6 4 24 4-24z" fill="#000"/><path d="M6 60h7v-6h4v6h3v8h-5l-2 22H6z"/>`,
  wolf: `${BODY}<path d="M35 34l-5-22 13 13zM65 34l5-22-13 13z"/><path d="M42 47l4 3M58 47l-4 3" stroke="#000" stroke-width="2.5"/>`,
};
const roleIcon = (r, cls = '') => `<svg class="ricon ${cls}" viewBox="0 0 100 100" fill="currentColor">${ICONS[r.ico]}</svg>`;
const FORMATS = [
  { n: 'Мафия', s: 'Классика, квиз-мафия, на английском' },
  { n: 'Бункер', s: 'Классический или на английском' },
  { n: 'Квест', s: 'Дома или на байках по острову' },
  { n: 'Cash Flow', s: 'Корпоратив или своей компанией' },
  { n: 'Квиз', s: 'Корпоративный или на событие' },
  { n: 'Мини-игры', s: 'Интерактив для праздника' },
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
const LOGO = '<img class="logo" src="logo.png" alt="Game Phuket" width="52" height="52">';
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
function done(title, msg, after) {
  notify('success');
  const fin = after || back; // формы-вкладки остаются на месте, остальные экраны — назад
  if (inTG && tg.showPopup) tg.showPopup({ title, message: msg, buttons: [{ type: 'ok' }] }, fin);
  else { toast(title + ' ✓'); setTimeout(fin, 900); }
}

function resetCity() { haptic(); city = ''; store.set(CITY_KEY, ''); go('city'); }

/* ---------------- роутер ---------------- */
let city = '';
const home = () => { const c = cityById(city); return !c ? 'city' : c.status === 'active' ? 'afisha' : 'soon'; };
const go = (r) => { if (location.hash.slice(1) === r) route(); else location.hash = r; };
const TABS = ['afisha', 'games', 'order', 'club', 'admin'];
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
  const SCREENS = { city: City, soon: Soon, afisha: Afisha, games: Games, order: Order, club: Club, event: EventPage, pay: Pay, paydone: PayDone, ask: Ask, coop: Coop, admin: Admin, admincity: AdminCity, adminevent: AdminEvent };
  let full = location.hash.slice(1);
  // Telegram дописывает в адрес #tgWebAppData=… — это не экран; неизвестные адреса тоже ведём на стартовый
  if (!SCREENS[full.split('/')[0]]) full = home();
  if (full.startsWith('admin') && !IS_ADMIN) full = home();
  const [r, ...rest] = full.split('/'); const arg = rest.join('/');
  const root = TABS.includes(r) || r === 'city' || (r === 'soon' && cityById(city)?.status === 'soon');
  if (root) stack.length = 0; // вкладки — корневые экраны
  else if (!goingBack && cur && cur !== full) stack.push(cur);
  goingBack = false; cur = full;
  sheetClose?.(true);
  mainButton(null);
  EVENTS = buildEvents();
  $('#tab-admin').style.display = IS_ADMIN ? '' : 'none';
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
        <button class="city ${i === first ? 'hot' : ''}" data-city="${esc(c.id)}"><div><div class="d">${esc(c.name)}</div><small>${c.status === 'active' ? esc(c.sub || 'афиша и записи') : 'скоро открытие'}</small></div><span class="arrow">→</span></button>`).join('')
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
  <button class="btn white" data-ig>Следить в Instagram</button>
  ${other ? `<button class="btn ghost" style="margin-top:8px" data-city="${esc(other.id)}">Смотреть афишу: ${esc(other.name)}</button>` : ''}
  <button class="btn ghost" style="margin-top:8px;border:0;color:var(--mute)" data-reset>Сменить город</button>`;
  },
  bind: () => { City.bind(); $('[data-ig]').onclick = () => openLink('https://instagram.com/game.phuket'); $('[data-reset]').onclick = resetCity; },
};

let selDay = null;
const Afisha = {
  html: () => {
    if (!EVENTS.length) return `${header(`<button class="pill" data-pick aria-label="Сменить город"><i></i>${esc(cityById(city).name)}<span class="chev">▾</span></button>`)}
      <div class="ahead"><h1 class="d">Афиша</h1></div>
      <div class="empty"><b class="d">Пока пусто</b><p>В этом городе ещё нет запланированных игр. Загляните позже или напишите нам.</p>
      <button class="btn ghost" data-go="ask">Задать вопрос</button></div>`;
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
      <button class="ev ${e.blue ? 'bl' : ''}" data-go="event/${esc(e.id)}">
        <div class="day">${WD_FULL[e.dow]}, ${fmtDate(e)}</div>
        <div class="ttl">${esc(e.type || e.title)}</div>
        <div class="meta"><b>${e.time}</b> ${esc(e.place)}${e.area && !e.blue ? ', ' + esc(e.area) : ''}</div>
        <span class="go">›</span>
      </button>`).join('')}
    <div class="sec"><h3 class="d">Впервые?</h3></div>
    <button class="ev" data-go="games" style="border-left-color:#fff">
      <div class="ttl">Я никогда не играл в Мафию. Нужно готовиться?</div>
      <div class="meta">Роли, правила и 3 способа вычислить мафию</div><span class="go">›</span>
    </button>`;
  },
  bind: () => {
    $('[data-pick]')?.addEventListener('click', () => { haptic(); openCitySheet(); });
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
    <div class="where">${e.time} · ${esc(e.place)} · <b>${priceTxt(e.price)}</b></div>
    <div class="count" data-ts="${e.ts}"><div><b>–</b><span>дн</span></div><div><b>–</b><span>час</span></div><div><b>–</b><span>мин</span></div><div><b>–</b><span>сек</span></div></div>
  </div>`;
}
let tick;
function bindFeature() {
  const f = $('.feature');
  f.addEventListener('click', () => { haptic(); go(f.dataset.feat); });
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
      <div class="fact wide"><span>Где</span><b>${esc(e.place)}</b><div class="mute" style="font-size:13px;margin-top:2px">${esc(e.area)}</div></div>
      <div class="fact"><span>Стоимость</span><b>${priceTxt(e.price)}</b></div>
      ${e.dur ? `<div class="fact"><span>Длительность</span><b>${esc(e.dur)}</b></div>` : ''}
    </div>
    <div class="stepper"><div><div style="font-weight:500">Сколько вас?</div><div class="mute" style="font-size:12px">можно с друзьями</div></div>
      <div class="ctl"><button data-s="-1">−</button><output id="cnt">1</output><button data-s="1">+</button></div></div>
    ${e.price ? `<div class="total"><span class="mute">Итого</span><b id="sum">${e.price} ฿</b></div>` : ''}
    <button class="btn ghost" style="margin-top:18px" data-go="ask">Задать вопрос</button>`;
  },
  bind: (id) => {
    const e = EVENTS.find((x) => x.id === id) || EVENTS[0];
    if (!e) return;
    let n = 1;
    const label = () => `Записаться${n > 1 ? ` · ${n} чел.` : ''}`;
    $$('[data-s]').forEach((b) => b.addEventListener('click', () => {
      const v = Math.min(10, Math.max(1, n + +b.dataset.s));
      if (v === n) return notify('warning');
      n = v; hapticSel();
      $('#cnt').textContent = n;
      if ($('#sum')) $('#sum').textContent = `${e.price * n} ฿`;
      mainButton(label(), submit);
    }));
    const submit = () => {
      reg = { id: e.id, n };
      if (e.price === 0) return sendRegistration(e, n, 'free');   // бесплатно — сразу запись, без оплаты
      go(`pay/${e.id}`);
    };
    mainButton(label(), submit);
  },
};

/* ---------------- запись и оплата ---------------- */
let reg = null;          // { id, n } — выбранное мероприятие и число человек
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
  go(`paydone/${e.id}/${r.j.kind}`);
}

// Заявки из форм (вопрос, сотрудничество, заказ игр) — в чат менеджеров, под участника создаётся своя тема
async function sendRequest(type, data, title, okMsg, after) {
  if (sending) return;
  if (!API_OK || !inTG) { notify('error'); return toast('Отправка работает только в Telegram'); }
  sending = true;
  tg?.MainButton.showProgress?.(); const fb = $('#fbtn'); if (fb) { fb.disabled = true; fb.textContent = 'Отправляем…'; }
  const r = await getJSON(API + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify({ type, ...data }) }, 12000);
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
    if (!reg || reg.id !== id) reg = { id, n: 1 };
    return `
    <p class="cap">Запись на игру</p>
    <h1 class="d" style="font-size:40px;margin-top:8px">${esc(e.title)}</h1>
    <p class="mute" style="margin-top:8px;font-size:14px">${whenTxt(e)} · ${esc(e.place)} · ${reg.n} чел.</p>
    <div id="paybox"><p class="mute" style="padding:30px 0">Загружаем способы оплаты…</p></div>`;
  },
  bind: async (arg) => {
    const [id, method] = arg.split('/');
    const e = EVENTS.find((x) => x.id === id); if (!e) return;
    const box = $('#paybox'), n = reg.n;
    const pay = await loadPay();
    if (!document.contains(box)) return;
    const thb = e.price > 0, rub = pay?.rub?.perPlayer, usdt = pay?.usdt?.perPlayer;

    // шаг 1 — выбор способа
    if (!method) {
      receipt = null;
      const m = [
        thb && ['thb', '🇹🇭', 'Тайский счёт', `${e.price * n} ฿ · QR PromptPay`],
        rub && ['rub', '🇷🇺', 'Российский счёт', `${rub * n} ₽ · перевод на карту`],
        usdt && ['usdt', '₮', 'Криптовалюта', `${usdt * n} USDT · ${esc(pay.usdt.network || 'TRC-20')}`],
        ['manager', '💬', 'Нет такого способа', 'Связаться с менеджером'],
      ].filter(Boolean);
      box.innerHTML = `<div class="sec" style="margin-top:22px"><h3 class="d">Способ оплаты</h3></div>
        <div class="pms">${m.map(([k, ic, t, s]) => `<button class="pm ${k === 'manager' ? 'alt' : ''}" data-pm="${k}"><span class="ic">${ic}</span><div><b>${t}</b><small>${s}</small></div><span class="go">›</span></button>`).join('')}</div>
        ${pay ? '' : '<p class="hint" style="margin-top:12px">Реквизиты недоступны. Откройте приложение из Telegram.</p>'}`;
      $$('[data-pm]').forEach((b) => b.addEventListener('click', () => { haptic(); go(`pay/${id}/${b.dataset.pm}`); }));
      return;
    }

    // шаг 2 — реквизиты и чек
    if (method === 'manager') {
      box.innerHTML = `<div class="sec" style="margin-top:22px"><h3 class="d">Связаться с менеджером</h3></div>
        <p class="lead" style="font-size:14px">Заявка уйдёт менеджеру с пометкой «нет возможности оплатить». Он свяжется с вами и подскажет, как оплатить.</p>
        <div class="field"><label>Комментарий (необязательно)</label><textarea class="inp" id="pm-note" maxlength="300" placeholder="Например: «Живу в другой стране, удобнее оплатить картой»"></textarea></div>`;
      mainButton('Отправить заявку менеджеру', () => sendRegistration(e, n, 'manager', $('#pm-note').value.trim()));
      return;
    }
    const amount = method === 'thb' ? `${e.price * n} ฿` : method === 'rub' ? `${rub * n} ₽` : `${usdt * n} USDT`;
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
      ${e ? `<div class="ticket"><span class="cap">${esc(e.title)}</span><b class="d">${whenTxt(e)}</b><p>${esc(e.place)}${e.area ? ', ' + esc(e.area) : ''}</p><p>${(reg?.n || 1)} чел.</p></div>` : ''}
      <p class="hint" style="text-align:center">${paid ? 'Подтверждение придёт и в чат с ботом.' : ''}</p>
      <button class="btn" data-go="afisha" style="margin-top:20px">В афишу</button>
    </section>`;
  },
  bind: () => { stack.length = 0; receipt = null; },
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
    <div class="sec"><h3 class="d">Как проходит <span class="red">мафия</span></h3></div>
    <div class="steps">
      ${[['Распределение ролей', 'Ведущий тайно распределяет карты.'], ['Фаза ночи', 'Действуют все особые игровые роли.'], ['Фаза дня', 'Обсуждение и голосование против игрока.'], ['Условия победы', 'Мафия — при равенстве или превосходстве, мирные — при ликвидации мафии.']]
        .map(([t, d], i) => `<div class="step"><span class="n">${i + 1}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    </div>
  </section>

  <section id="roles" class="anchor">
    <div class="sec"><h3 class="d">Роли</h3><span class="cap">${ROLES.length} ролей</span></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 14px">Добавляются по мере увеличения игроков. Нажми на карту.</p>
    <div class="rgrid">${ROLES.map((r) => `
      <button class="rcard" data-role="${r.id}">${roleIcon(r)}<span>${r.n}</span></button>`).join('')}
    </div>
    <div class="jargon">
      <div><i class="dot r"></i><div><b>Красные игроки</b><p>Роли мирного города: Мирный, Шериф, Доктор, Детектив, Оборотень — пока не обернулся.</p></div></div>
      <div><i class="dot b"></i><div><b>Чёрные игроки</b><p>Роли с возможностью выстрела: Мафия, Хитман.</p></div></div>
    </div>
  </section>

  <section id="gest" class="anchor">
    <div class="sec"><h3 class="d">Жесты <span class="red">ведущего</span></h3></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 12px">Ночью ведущий показывает результаты проверок жестами.</p>
    <div class="gest">${GESTURES.map(([e, t, d]) => `<div><span class="em">${e}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
  </section>

  <section id="rules" class="anchor">
    <div class="sec"><h3 class="d red">Важно!</h3></div>
    <ol class="rules">${RULES.map((r) => `<li>${r}</li>`).join('')}</ol>
  </section>

  <section id="strike" class="anchor">
    <div class="sec"><h3 class="d">Страйки</h3></div>
    <p class="mute" style="font-size:13px;margin:-4px 0 14px">Система штрафов, когда игрок нарушает правила игры или мешает игрокам.</p>
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
          <div><b>${esc(c.name)}</b><small>${c.status === 'active' ? esc(c.sub || 'афиша и записи') : 'скоро открытие'}</small></div>
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
        <div class="frame">${roleIcon(r, 'big')}</div>
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

const Club = {
  html: () => {
    const weekly = EVENTS.length, comm = EVENTS.find((x) => x.blue);
    const stats = [['2500+', 'участников'], weekly ? [String(weekly), 'игр в неделю'] : null, comm && comm.price === 0 ? ['0 ฿', esc(comm.type || comm.title)] : null].filter(Boolean);
    return `
  ${header()}
  <h1 class="d big">Game<br><span class="red">Phuket</span></h1>
  <p class="lead" style="margin-top:12px">Игры · Тематические вечера · Частные события</p>
  <div class="stats" style="grid-template-columns:repeat(${stats.length},1fr)">${stats.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('')}</div>
  ${comm ? `<div class="comm">
    <span class="cap blue">${WD_FULL[comm.dow]}</span>
    <h3 class="d" style="margin-top:8px">${esc(comm.title)}</h3>
    <p>${esc(comm.desc)}</p>
    <button class="btn white" data-go="event/${esc(comm.id)}">Подробнее</button>
  </div>` : ''}
  <div class="links">
    <button class="lnk" data-go="coop"><div><b>Сотрудничество</b><small>Площадки, бренды, партнёры</small></div><span>→</span></button>
    <button class="lnk" data-go="ask"><div><b>Задать вопрос</b><small>Ответим в ближайшее время</small></div><span>→</span></button>
    <button class="lnk" data-ig><div><b>Instagram</b><small>@game.phuket</small></div><span>↗</span></button>
    <button class="lnk" data-city="reset"><div><b>Сменить город</b><small>Сейчас: ${esc(cityById(city)?.name || '')}</small></div><span>→</span></button>
  </div>
  <p class="cap" style="text-align:center;margin-top:30px">${sparks()}</p>`;
  },
  bind: () => {
    $('[data-ig]').onclick = () => openLink('https://instagram.com/game.phuket');
    $('[data-city=reset]').onclick = resetCity;
  },
};

function formScreen(type, cap, title, red, lead, ph, ok) {
  return {
    html: () => `
    ${header()}
    <p class="cap">${cap}</p>
    <h1 class="d big" style="margin-top:10px">${title}<br><span class="red">${red}</span></h1>
    <p class="lead" style="margin-top:12px">${lead}</p>
    <div class="field"><label>Как к вам обращаться</label>
      <input class="inp" id="fn" placeholder="Имя" value="${tgUser('name')}">
      <input class="inp" id="fc" placeholder="Телефон или @username" value="${tgUser('contact')}"></div>
    <div class="field"><label>Сообщение</label><textarea class="inp" id="fm" placeholder="${ph}"></textarea></div>`,
    bind: () => mainButton('Отправить', () => {
      if (!$('#fc').value.trim() || !$('#fm').value.trim()) { notify('error'); return toast('Заполните контакт и сообщение'); }
      sendRequest(type, { name: $('#fn').value.trim(), contact: $('#fc').value.trim(), message: $('#fm').value.trim() }, 'Отправлено', ok);
    }),
  };
}
const Ask = formScreen('ask', 'Есть вопрос?', 'Напишите', 'нам', 'Про игры, запись или частное мероприятие — ответим лично.', 'Ваш вопрос', 'Менеджер ответит вам в ближайшее время.');
const Coop = formScreen('coop', 'Для площадок и брендов', 'Давайте', 'дружить', 'Мы организуем и проводим развлекательные игры на острове и всегда открыты к взаимовыгодному сотрудничеству.', 'Как вы видите наше сотрудничество?', 'Менеджер свяжется с вами и договорится о встрече.');

/* ---------------- админка (только для ADMIN_IDS) ---------------- */
let admTab = 'events', admCity = '';
const confirmBox = (msg) => new Promise((res) => (inTG && tg.showConfirm ? tg.showConfirm(msg, res) : res(confirm(msg))));
const clone = (o) => JSON.parse(JSON.stringify(o));
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
const evWhen = (e) => (e.repeat === 'once'
  ? `${Number(e.date.slice(8))} ${MON[Number(e.date.slice(5, 7)) - 1]}${e.date < new Date().toISOString().slice(0, 10) ? ' · прошло' : ''}`
  : `Каждую неделю · ${WD[e.dow].toLowerCase()}`) + `, ${e.time}`;

async function saveCfg(next) {
  const r = await getJSON(API + '/api/admin/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Init-Data': tg?.initData || '' }, body: JSON.stringify({ config: next, rev: REV }) }, 8000);
  if (r.ok) { CFG = r.j.config; REV = r.j.rev; ls.set('gp_cfg', JSON.stringify(CFG)); notify('success'); return true; }
  notify('error');
  if (r.status === 409 && r.j?.config) { CFG = r.j.config; REV = r.j.rev; toast('Данные обновились — повторите'); route(); }
  else toast(r.status === 403 ? 'Нет доступа' : r.status === 0 ? 'Нет связи с сервером' : r.j?.error || 'Не удалось сохранить');
  return false;
}

const Admin = {
  html: () => {
    if (!CFG.cities.some((c) => c.id === admCity)) admCity = CFG.cities[0]?.id || '';
    const evs = CFG.events.filter((e) => e.city === admCity)
      .sort((a, b) => (a.repeat === b.repeat ? (a.repeat === 'once' ? a.date.localeCompare(b.date) : ((a.dow + 6) % 7) - ((b.dow + 6) % 7)) : a.repeat === 'once' ? 1 : -1) || a.time.localeCompare(b.time));
    return `
    ${header('<span class="pill"><i></i>Админка</span>')}
    <h1 class="d big" style="font-size:46px">Управление</h1>
    <div class="seg" style="margin-top:18px"><button data-at="events" class="${admTab === 'events' ? 'on' : ''}">Афиша</button><button data-at="cities" class="${admTab === 'cities' ? 'on' : ''}">Города</button></div>
    ${admTab === 'events' ? (CFG.cities.length ? `
      <div class="chips-row">${CFG.cities.map((c) => `<button class="chip ${c.id === admCity ? 'on' : ''}" data-ac="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <div style="margin-top:14px">${evs.length ? evs.map((e) => `
        <button class="ev adm ${e.blue ? 'bl' : ''} ${e.active === false ? 'off' : ''}" data-go="adminevent/${esc(e.id)}">
          <div class="day">${evWhen(e)}</div><div class="ttl">${esc(e.title)}</div>
          <div class="meta">${esc(e.place)} · ${priceTxt(e.price)}${e.active === false ? ' · <b>скрыто</b>' : ''}</div><span class="go">›</span>
        </button>`).join('') : '<p class="mute" style="padding:18px 2px">В этом городе пока нет мероприятий.</p>'}</div>
      <button class="btn" data-go="adminevent/new">+ Добавить мероприятие</button>` : '<p class="mute" style="padding:18px 2px">Сначала добавьте город.</p>')
    : `
      <div style="margin-top:14px">${CFG.cities.map((c, i) => `
        <div class="ev adm ${c.status === 'soon' ? 'off' : ''}" style="padding-right:96px" data-go="admincity/${esc(c.id)}">
          <div class="day">${c.status === 'active' ? 'Активен' : 'Скоро'}</div><div class="ttl">${esc(c.name)}</div>
          <div class="meta">${CFG.events.filter((e) => e.city === c.id).length} мероприятий · UTC${c.tz >= 0 ? '+' : ''}${c.tz}</div>
          <span class="mv"><i data-mv="${i}:-1" class="${i ? '' : 'dis'}">↑</i><i data-mv="${i}:1" class="${i < CFG.cities.length - 1 ? '' : 'dis'}">↓</i></span>
        </div>`).join('')}</div>
      <button class="btn" data-go="admincity/new">+ Добавить город</button>`}
    <p class="cap" style="margin-top:22px;line-height:1.6">${API_OK ? 'Изменения сразу видны всем пользователям.' : 'Нет связи с сервером — сохранить изменения нельзя.'}</p>`;
  },
  bind: () => {
    $$('[data-at]').forEach((b) => b.addEventListener('click', () => { hapticSel(); admTab = b.dataset.at; route(); }));
    $$('[data-ac]').forEach((b) => b.addEventListener('click', () => { hapticSel(); admCity = b.dataset.ac; route(); }));
    $$('[data-mv]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const [i, d] = b.dataset.mv.split(':').map(Number), j = i + d;
      if (j < 0 || j >= CFG.cities.length) return;
      const next = clone(CFG); [next.cities[i], next.cities[j]] = [next.cities[j], next.cities[i]];
      hapticSel(); if (await saveCfg(next)) route();
    }));
  },
};

const AdminCity = {
  html: (id) => {
    const c = id === 'new' ? { name: '', sub: '', status: 'active', tz: 7 } : cityById(id);
    if (!c) return '<div class="empty"><b class="d">Город не найден</b></div>';
    return `
    <h1 class="d big">${id === 'new' ? 'Новый<br><span class="red">город</span>' : esc(c.name)}</h1>
    <div class="field"><label>Название</label><input class="inp" id="c-name" maxlength="60" placeholder="Например: Бангкок" value="${esc(c.name)}"></div>
    <div class="field"><label>Статус</label><div class="seg" id="c-status"><button data-v="active" class="${c.status === 'active' ? 'on' : ''}">Работает</button><button data-v="soon" class="${c.status === 'soon' ? 'on' : ''}">Скоро открытие</button></div></div>
    <div class="field"><label>Подпись в списке</label><input class="inp" id="c-sub" maxlength="80" placeholder="5 вечеров в неделю" value="${esc(c.sub)}"></div>
    <div class="field"><label>Часовой пояс (UTC+)</label><input class="inp" id="c-tz" type="number" step="0.5" min="-12" max="14" value="${c.tz}"><p class="hint">Нужен, чтобы время игр и отсчёт считались по местному времени. Пхукет +7, Москва и Петербург +3.</p></div>
    ${id !== 'new' ? '<button class="btn ghost danger" id="c-del">Удалить город</button>' : ''}`;
  },
  bind: (id) => {
    let status = id === 'new' ? 'active' : cityById(id)?.status;
    $$('#c-status button').forEach((b) => b.addEventListener('click', () => { hapticSel(); status = b.dataset.v; $$('#c-status button').forEach((x) => x.classList.toggle('on', x === b)); }));
    mainButton('Сохранить', async () => {
      const name = $('#c-name').value.trim();
      if (!name) { notify('error'); return toast('Введите название города'); }
      const next = clone(CFG), tz = Number($('#c-tz').value);
      const row = { id: id === 'new' ? newId('c') : id, name, status, sub: $('#c-sub').value.trim(), tz: Number.isFinite(tz) ? tz : 0 };
      if (id === 'new') next.cities.push(row); else next.cities[next.cities.findIndex((c) => c.id === id)] = row;
      if (await saveCfg(next)) { toast('Сохранено'); back(); }
    });
    $('#c-del')?.addEventListener('click', async () => {
      const n = CFG.events.filter((e) => e.city === id).length;
      if (!(await confirmBox(`Удалить город «${cityById(id).name}»${n ? ` и его мероприятия (${n})` : ''}?`))) return;
      const next = clone(CFG); next.cities = next.cities.filter((c) => c.id !== id); next.events = next.events.filter((e) => e.city !== id);
      if (await saveCfg(next)) { if (city === id) { city = ''; store.set(CITY_KEY, ''); } toast('Город удалён'); back(); }
    });
  },
};

const AdminEvent = {
  html: (id) => {
    const e = id === 'new' ? { city: admCity, repeat: 'weekly', dow: 5, date: '', time: '19:00', type: 'Мафия', title: '', place: '', area: '', price: null, dur: 'до 4 часов', desc: '', blue: false, active: true } : CFG.events.find((x) => x.id === id);
    if (!e) return '<div class="empty"><b class="d">Мероприятие не найдено</b></div>';
    const dows = [1, 2, 3, 4, 5, 6, 0];
    return `
    <h1 class="d big">${id === 'new' ? 'Новое<br><span class="red">мероприятие</span>' : esc(e.title)}</h1>
    <div class="field"><label>Город</label><select class="inp" id="e-city">${CFG.cities.map((c) => `<option value="${esc(c.id)}" ${c.id === e.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Когда</label>
      <div class="seg" id="e-rep"><button data-v="weekly" class="${e.repeat === 'weekly' ? 'on' : ''}">Каждую неделю</button><button data-v="once" class="${e.repeat === 'once' ? 'on' : ''}">Один раз</button></div>
      <select class="inp" id="e-dow" style="margin-top:8px">${dows.map((d) => `<option value="${d}" ${d === e.dow ? 'selected' : ''}>${WD_FULL[d]}</option>`).join('')}</select>
      <input class="inp" type="date" id="e-date" value="${esc(e.date || '')}" style="margin-top:8px">
      <input class="inp" type="time" id="e-time" value="${esc(e.time)}">
    </div>
    <div class="field"><label>Название</label><input class="inp" id="e-title" maxlength="80" placeholder="Мафия на Раваи" value="${esc(e.title)}">
      <input class="inp" id="e-type" maxlength="40" placeholder="Формат: Мафия, Бункер, Квиз…" value="${esc(e.type)}"></div>
    <div class="field"><label>Место</label><input class="inp" id="e-place" maxlength="100" placeholder="Название заведения" value="${esc(e.place)}">
      <input class="inp" id="e-area" maxlength="80" placeholder="Район / город" value="${esc(e.area)}"></div>
    <div class="field"><label>Стоимость, ฿</label><input class="inp" id="e-price" type="number" min="0" step="1" inputmode="numeric" placeholder="Пусто — «Уточняйте», 0 — «Бесплатно»" value="${e.price ?? ''}">
      <input class="inp" id="e-dur" maxlength="40" placeholder="Длительность: до 4 часов" value="${esc(e.dur)}"></div>
    <div class="field"><label>Описание</label><textarea class="inp" id="e-desc" maxlength="1000" placeholder="Пара предложений о мероприятии">${esc(e.desc)}</textarea></div>
    <div class="field">
      <label class="sw"><input type="checkbox" id="e-blue" ${e.blue ? 'checked' : ''}><i></i><span>Синий акцент <small>(для Community Day и подобных)</small></span></label>
      <label class="sw"><input type="checkbox" id="e-active" ${e.active !== false ? 'checked' : ''}><i></i><span>Показывать в афише</span></label>
    </div>
    ${id !== 'new' ? '<button class="btn ghost danger" id="e-del">Удалить мероприятие</button>' : ''}`;
  },
  bind: (id) => {
    let repeat = id === 'new' ? 'weekly' : CFG.events.find((x) => x.id === id)?.repeat;
    const sync = () => { $('#e-dow').style.display = repeat === 'weekly' ? '' : 'none'; $('#e-date').style.display = repeat === 'once' ? '' : 'none'; };
    sync();
    $$('#e-rep button').forEach((b) => b.addEventListener('click', () => { hapticSel(); repeat = b.dataset.v; $$('#e-rep button').forEach((x) => x.classList.toggle('on', x === b)); sync(); }));
    mainButton('Сохранить', async () => {
      const v = (k) => $('#e-' + k).value.trim();
      if (!v('title')) { notify('error'); return toast('Введите название'); }
      if (!v('time')) { notify('error'); return toast('Укажите время'); }
      if (repeat === 'once' && !v('date')) { notify('error'); return toast('Укажите дату'); }
      const row = { id: id === 'new' ? newId('e') : id, city: v('city'), repeat, time: v('time'), type: v('type'), title: v('title'), place: v('place'), area: v('area'),
        price: v('price') === '' ? null : Math.max(0, Math.round(Number(v('price')))), dur: v('dur'), desc: v('desc'), blue: $('#e-blue').checked, active: $('#e-active').checked };
      if (repeat === 'once') row.date = v('date'); else row.dow = Number(v('dow'));
      const next = clone(CFG);
      if (id === 'new') next.events.push(row); else next.events[next.events.findIndex((x) => x.id === id)] = row;
      if (await saveCfg(next)) { admCity = row.city; toast('Сохранено'); back(); }
    });
    $('#e-del')?.addEventListener('click', async () => {
      if (!(await confirmBox('Удалить это мероприятие?'))) return;
      const next = clone(CFG); next.events = next.events.filter((x) => x.id !== id);
      if (await saveCfg(next)) { toast('Удалено'); back(); }
    });
  },
};

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function tgUser(k) {
  const u = tg?.initDataUnsafe?.user;
  if (!u) return '';
  return k === 'name' ? [u.first_name, u.last_name].filter(Boolean).join(' ') : u.username ? '@' + u.username : '';
}

/* ---------------- старт ---------------- */
(async () => {
  if (tg) {
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
