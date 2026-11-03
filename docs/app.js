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

const EVENTS = [
  { id: 'wed', dow: 3, type: 'Мафия', title: 'Мафия в Вичите', place: 'Beerfest Brewery', area: 'Вичит', price: 600, dur: 'до 4 часов',
    desc: 'Мафия — это место, где мы кричим, смеёмся и избавляемся от стресса. Вечер заряжен на эмоции — осталось занять место за столом.' },
  { id: 'thu', dow: 4, type: 'Community Day', title: 'Community Day', place: 'Меняется каждую неделю', area: 'уточняйте в чате', price: 0, dur: 'до 3 часов', blue: true,
    desc: 'Бесплатные встречи для нашего комьюнити: ужины, сауна, кино и многое другое.' },
  { id: 'fri', dow: 5, type: 'Мафия', title: 'Мафия на Банг-Тао', place: 'Shishka UMAY', area: 'Банг-Тао', price: null, dur: 'до 4 часов',
    desc: 'Мафия по пятницам заряжает лучше, чем поход на Бангла-роуд.' },
  { id: 'sat', dow: 6, type: 'Мафия', title: 'Мафия на Раваи', place: 'Boss Level', area: 'Раваи', price: null, dur: 'до 4 часов',
    desc: 'Та самая равайская Мафия — с криками и смехом.' },
  { id: 'sun', dow: 0, type: 'Мафия', title: 'Мафия на Банг-Тао', place: 'LAVA Restobar', area: 'Банг-Тао', price: null, dur: 'до 4 часов',
    desc: 'На этой Мафии собираются самые важные люди острова.' },
];
// ближайшая дата для каждого дня недели, 19:00 по Пхукету (UTC+7)
const nowPhuket = () => new Date(Date.now() + 7 * 3600e3);
EVENTS.forEach((e) => {
  const n = nowPhuket();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 19));
  let add = (e.dow - d.getUTCDay() + 7) % 7;
  if (add === 0 && n.getUTCHours() >= 19) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  e.date = d; // «фейковый UTC» = местное время Пхукета
  e.ts = d.getTime() - 7 * 3600e3;
});
EVENTS.sort((a, b) => a.ts - b.ts);
const fmtDate = (e) => `${e.date.getUTCDate()} ${MON[e.date.getUTCMonth()]}`;
const priceTxt = (p) => (p === 0 ? 'Бесплатно' : p ? `${p} ฿` : 'Уточняйте');

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
const LOGO = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#0d1a33" stroke="#ff2b22" stroke-width="1.5"/>
  <path d="M15 11c-5 1-7 5-6.5 9.5S12 29 16 29c1.5 0 2.5-1 2.5-2.5V12.5c0-1-1.5-1.8-3.5-1.5z" fill="#fff"/>
  <path d="M23 13c4 0 7 3 7 7.5S27 28 24 28c-1.2 0-2-.8-2-2V14c0-.6.4-1 1-1z" fill="#fff" opacity=".85"/>
  <path d="M29 8l.6 2.2L32 11l-2.4.8L29 14l-.6-2.2L26 11l2.4-.8z" fill="#ff2b22"/></svg>`;
const header = (right = '') => `<div class="bar"><div class="brand">${LOGO}<b>Game<br>Phuket</b></div>${right}</div>`;

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
    b.id = 'fbtn'; b.className = 'btn fixed'; b.textContent = text; b.onclick = fn;
    document.body.append(b);
  }
}
function done(title, msg, after) {
  notify('success');
  const fin = after || back; // формы-вкладки остаются на месте, остальные экраны — назад
  if (inTG && tg.showPopup) tg.showPopup({ title, message: msg + '\n\nДемо-режим: заявка не отправляется.', buttons: [{ type: 'ok' }] }, fin);
  else { toast(title + ' ✓'); setTimeout(fin, 900); }
}

function resetCity() { haptic(); city = ''; store.set(CITY_KEY, ''); go('city'); }

/* ---------------- роутер ---------------- */
let city = '';
const home = () => (city === 'spb' ? 'spb' : city ? 'afisha' : 'city');
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
  const SCREENS = { city: City, spb: Spb, afisha: Afisha, games: Games, order: Order, club: Club, event: EventPage, ask: Ask, coop: Coop };
  let full = location.hash.slice(1);
  // Telegram дописывает в адрес #tgWebAppData=… — это не экран; неизвестные адреса тоже ведём на стартовый
  if (!SCREENS[full.split('/')[0]]) full = home();
  const [r, arg] = full.split('/');
  const root = TABS.includes(r) || r === 'city' || (r === 'spb' && city === 'spb');
  if (root) stack.length = 0; // вкладки — корневые экраны
  else if (!goingBack && cur && cur !== full) stack.push(cur);
  goingBack = false; cur = full;
  sheetClose?.(true);
  mainButton(null);
  const isTab = TABS.includes(r);
  document.body.classList.toggle('notabs', !isTab);
  $('#tabs').style.display = r === 'city' || r === 'spb' ? 'none' : '';
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
  html: () => `
  <section class="splash">
    ${MASK('float')}
    <div>
      ${header()}
      <h1 class="d"><span>Мафия</span><span class="red">клуб</span><span style="font-size:.5em;margin-top:10px">${sparks()}</span></h1>
      <p class="lead">2500+ участников. К нам возвращаются даже те, кто не любил Мафию.</p>
    </div>
    <div>
      <p class="cap">Где ты сейчас?</p>
      <div class="cities">
        <button class="city hot" data-city="phuket"><div><div class="d">Пхукет</div><small>5 вечеров в неделю</small></div><span class="arrow">→</span></button>
        <button class="city" data-city="spb"><div><div class="d">Санкт-Петербург</div><small>скоро открытие</small></div><span class="arrow">→</span></button>
      </div>
    </div>
  </section>`,
  bind: () => $$('[data-city]').forEach((b) => b.addEventListener('click', () => {
    haptic('medium');
    city = b.dataset.city; store.set(CITY_KEY, city);
    go(city === 'phuket' ? 'afisha' : 'spb');
  })),
};

const Spb = {
  html: () => `
  ${header()}
  <section class="splash" style="min-height:70vh;justify-content:center">
    ${MASK('float')}
    <div>
      <p class="cap">Санкт-Петербург</p>
      <h1 class="d" style="font-size:64px;margin-top:14px">Скоро<br><span class="red">открытие</span></h1>
      <p class="lead">Готовим игры в Петербурге. Анонс — первым делом в Instagram.</p>
    </div>
  </section>
  <button class="btn white" data-ig>Следить в Instagram</button>
  <button class="btn ghost" style="margin-top:8px" data-city="phuket">Смотреть афишу Пхукета</button>
  <button class="btn ghost" style="margin-top:8px;border:0;color:var(--mute)" data-reset>Сменить город</button>`,
  bind: () => { City.bind(); $('[data-ig]').onclick = () => openLink('https://instagram.com/game.phuket'); $('[data-reset]').onclick = resetCity; },
};

let selDay = null;
const Afisha = {
  html: () => {
    const first = EVENTS[0], last = EVENTS[EVENTS.length - 1];
    const range = first.date.getUTCMonth() === last.date.getUTCMonth()
      ? `${first.date.getUTCDate()} – ${fmtDate(last)}` : `${fmtDate(first)} – ${fmtDate(last)}`;
    const sel = EVENTS.find((e) => e.id === selDay) || first;
    return `
    ${header(`<span class="pill"><i></i>Пхукет</span>`)}
    <div class="ahead"><h1 class="d">Афиша</h1><div class="range">${range}</div></div>
    <div class="week">${EVENTS.map((e) => `
      <button class="wd ${e.blue ? 'bl' : ''} ${e === sel ? 'on' : ''}" data-day="${e.id}"><small>${WD[e.dow]}</small><b>${e.date.getUTCDate()}</b></button>`).join('')}
    </div>
    <div id="feat">${feature(sel)}</div>
    <div class="sec"><h3 class="d">Вся неделя</h3><span class="cap">19:00</span></div>
    ${EVENTS.map((e) => `
      <button class="ev ${e.blue ? 'bl' : ''}" data-go="event/${e.id}">
        <div class="day">${WD_FULL[e.dow]}, ${fmtDate(e)}</div>
        <div class="ttl">${e.type}</div>
        <div class="meta"><b>19:00</b> ${e.place}${e.area && !e.blue ? ', ' + e.area : ''}</div>
        <span class="go">›</span>
      </button>`).join('')}
    <div class="sec"><h3 class="d">Впервые?</h3></div>
    <button class="ev" data-go="games" style="border-left-color:#fff">
      <div class="ttl">Я никогда не играл в Мафию. Нужно готовиться?</div>
      <div class="meta">Роли, правила и 3 способа вычислить мафию</div><span class="go">›</span>
    </button>`;
  },
  bind: () => {
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
  <div class="feature ${e.blue ? 'bl' : ''}" data-feat="event/${e.id}">
    ${e.blue ? '' : MASK()}
    <span class="cap tag">${e === EVENTS[0] ? 'Ближайшая игра' : WD_FULL[e.dow]} · ${fmtDate(e)}</span>
    <h2 class="d">${e.title}</h2>
    <div class="where">19:00 · ${e.place} · <b>${priceTxt(e.price)}</b></div>
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
    return `
    <section class="poster ${e.blue ? 'bl' : ''}">
      <div class="num">${String(e.date.getUTCDate()).padStart(2, '0')}</div>
      <span class="cap ${e.blue ? 'blue' : 'red'}">${WD_FULL[e.dow]}, ${fmtDate(e)} · 19:00</span>
      <h1 class="d">${e.title}</h1>
      <p class="lead">${e.desc}</p>
    </section>
    <div class="facts">
      <div class="fact wide"><span>Где</span><b>${e.place}</b><div class="mute" style="font-size:13px;margin-top:2px">${e.area}</div></div>
      <div class="fact"><span>Стоимость</span><b>${priceTxt(e.price)}</b></div>
      <div class="fact"><span>Длительность</span><b>${e.dur}</b></div>
    </div>
    <div class="stepper"><div><div style="font-weight:500">Сколько вас?</div><div class="mute" style="font-size:12px">можно с друзьями</div></div>
      <div class="ctl"><button data-s="-1">−</button><output id="cnt">1</output><button data-s="1">+</button></div></div>
    ${e.price ? `<div class="total"><span class="mute">Итого на месте</span><b id="sum">${e.price} ฿</b></div>` : ''}
    <button class="btn ghost" style="margin-top:18px" data-go="ask">Задать вопрос</button>`;
  },
  bind: (id) => {
    const e = EVENTS.find((x) => x.id === id) || EVENTS[0];
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
    const submit = () => done('Вы записаны!', `${WD_FULL[e.dow]}, ${fmtDate(e)}, 19:00 — ${e.place}. Мест: ${n}.`);
    mainButton(label(), submit);
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
      done('Заявка принята', `${[...order.fmts].join(', ')} · ${order.guests} гостей · ${order.lang}. Менеджер свяжется с вами в ближайшее время.`, () => { order.date = order.note = ''; route(); });
    });
  },
};

const Club = {
  html: () => `
  ${header()}
  <h1 class="d big">Game<br><span class="red">Phuket</span></h1>
  <p class="lead" style="margin-top:12px">Игры · Тематические вечера · Частные события</p>
  <div class="stats"><div><b>2500+</b><span>участников</span></div><div><b>5</b><span>игр в неделю</span></div><div><b>0 ฿</b><span>Community Day</span></div></div>
  <div class="comm">
    <span class="cap blue">Каждый четверг</span>
    <h3 class="d" style="margin-top:8px">Community Day</h3>
    <p>Бесплатные встречи для своих: ужины, сауна, кино, кемпинги и Community Camp.</p>
    <button class="btn white" data-go="event/thu">Подробнее</button>
  </div>
  <div class="links">
    <button class="lnk" data-go="coop"><div><b>Сотрудничество</b><small>Площадки, бренды, партнёры</small></div><span>→</span></button>
    <button class="lnk" data-go="ask"><div><b>Задать вопрос</b><small>Ответим в ближайшее время</small></div><span>→</span></button>
    <button class="lnk" data-ig><div><b>Instagram</b><small>@game.phuket</small></div><span>↗</span></button>
    <button class="lnk" data-city="reset"><div><b>Сменить город</b><small>Сейчас: Пхукет</small></div><span>→</span></button>
  </div>
  <p class="cap" style="text-align:center;margin-top:30px">${sparks()}</p>`,
  bind: () => {
    $('[data-ig]').onclick = () => openLink('https://instagram.com/game.phuket');
    $('[data-city=reset]').onclick = resetCity;
  },
};

function formScreen(cap, title, red, lead, ph, ok) {
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
      done('Отправлено', ok);
    }),
  };
}
const Ask = formScreen('Есть вопрос?', 'Напишите', 'нам', 'Про игры, запись или частное мероприятие — ответим лично.', 'Ваш вопрос', 'Менеджер ответит вам в ближайшее время.');
const Coop = formScreen('Для площадок и брендов', 'Давайте', 'дружить', 'Мы организуем и проводим развлекательные игры на острове и всегда открыты к взаимовыгодному сотрудничеству.', 'Как вы видите наше сотрудничество?', 'Менеджер свяжется с вами и договорится о встрече.');

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
  if (inTG && tg.CloudStorage && tg.isVersionAtLeast?.('6.9')) try { tg.CloudStorage.removeItem('city'); } catch {} // старое облачное сохранение
  route();
})();
