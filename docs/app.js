/* Game Phuket — демо мини-апп. Без бэкенд-логики; использует Telegram Mini Apps API. */
const tg = window.Telegram?.WebApp;
const $ = (s) => document.querySelector(s);
const view = $('#view');

const EVENTS = {
  wed: { day: 'Среда', name: 'Мафия · Вичит', place: 'Beerfest Brewery', time: '19:00', price: '600 бат', dur: 'до 4-х часов', desc: 'Мафия — это место, где мы кричим, смеёмся и избавляемся от стресса. Вечер заряжен на эмоции. Всё, что вам осталось сделать, — занять место за игровым столом.' },
  thu: { day: 'Четверг', name: 'Community Day', place: 'Меняется каждую неделю — уточняйте в чате', time: '19:00', price: '0 бат', dur: 'до 3-х часов', blue: 1, desc: 'Формат бесплатных встреч для нашего комьюнити. Совместные походы в сауну, просмотры фильмов и многое другое.' },
  fri: { day: 'Пятница', name: 'Мафия · Банг-Тао', place: 'Shishka UMAY', time: '19:00', price: 'уточняйте', dur: 'до 4-х часов', desc: 'Мафия по пятницам заряжает лучше, чем поход на Бангла-роуд.' },
  sat: { day: 'Суббота', name: 'Мафия · Равай', place: 'Boss Level', time: '19:00', price: 'уточняйте', dur: 'до 4-х часов', desc: 'Та самая равайская Мафия с криками и смехом.' },
  sun: { day: 'Воскресенье', name: 'Мафия · Банг-Тао', place: 'LAVA Restobar', time: '19:00', price: 'уточняйте', dur: 'до 4-х часов', desc: 'На этой Мафии собираются самые важные люди острова.' },
};
const GAMES = {
  'Мафия': ['Классическая Мафия', 'Мафия на английском', 'Квиз Мафия', 'Квиз-Мафия на английском'],
  'Бункер': ['Классический Бункер', 'Бункер на английском'],
  'Квест': ['Квест на дому', 'Квест на байках по острову'],
  'Cash Flow': ['Корпоративная игра', 'Игра своей компанией'],
  'Квиз': ['Корпоративный квиз', 'Квиз на мероприятие'],
  'Мини-игры': ['Набор интерактивных мини-игр для праздника'],
};

/* ---------- Telegram API ---------- */
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred(t);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); }
function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#050505');
  tg.setBackgroundColor?.('#050505');
  tg.setBottomBarColor?.('#050505');
  tg.disableVerticalSwipes?.();
  const u = tg.initDataUnsafe?.user;
  if (u) $('#who').textContent = `Привет, ${u.first_name}`;
  tg.BackButton.onClick(() => { haptic(); history.back(); });
  // Серверная проверка подписи initData (нужен BOT_TOKEN на сервере) — на демо необязательна
  if (tg.initData) fetch('/api/auth', { method: 'POST', body: tg.initData }).catch(() => {});
}

/* ---------- MainButton helper ---------- */
let mainHandler = null;
function setMain(text, fn) {
  if (!tg) { $('#fb')?.remove(); if (text) { const b = Object.assign(document.createElement('button'), { id: 'fb', className: 'btn fixedbtn', textContent: text, onclick: fn }); document.body.append(b); } return; }
  if (mainHandler) tg.MainButton.offClick(mainHandler);
  if (!text) return tg.MainButton.hide();
  mainHandler = fn;
  tg.MainButton.setParams({ text, color: '#e8221f', text_color: '#ffffff', is_visible: true });
  tg.MainButton.onClick(fn);
}
function sent(what) {
  haptic('medium'); tg?.HapticFeedback?.notificationOccurred('success');
  const msg = `Демо: заявка «${what}» отправлена ✅`;
  tg?.showPopup ? tg.showPopup({ title: 'Готово', message: 'Менеджер свяжется с вами в ближайшее время.\n(демо-режим, данные не сохраняются)', buttons: [{ type: 'ok' }] }) : toast(msg);
  go('home');
}

/* ---------- Роутер (hash) ---------- */
const go = (r) => { location.hash = r === 'home' ? '' : r; };
function route() {
  const r = location.hash.slice(1) || (localStorage.city ? 'home' : 'city');
  window.scrollTo(0, 0);
  setMain(null);
  ['home', 'city'].includes(r) ? tg?.BackButton.hide() : tg?.BackButton.show();
  const [kind, id] = r.split('-');
  let html = '';
  if (r === 'city') html = city();
  else if (r === 'spb') html = spb();
  else if (r === 'home') html = home();
  else if (kind === 'event' && EVENTS[id]) html = event(id);
  else if (r === 'private-mafia') html = form('Мафия с ведущим', 'Команда организует лучшую Мафию на острове. Профессиональные ведущие, маски, стильные карточки с ролями и весь необходимый атрибут. Можем провести на английском.', 'Дата и количество гостей');
  else if (r === 'private-games') html = form('Игры на мероприятие', 'Организуем развлекательные игры под ключ в любой точке острова.', 'Дата, формат, количество гостей', true);
  else if (r === 'coop') html = form('Сотрудничество', 'Мы всегда открыты к взаимовыгодному сотрудничеству. Расскажите, как видите его, и оставьте контакты.', 'Ваше предложение');
  else if (r === 'ask') html = form('Задать вопрос', 'Напишите вопрос — менеджер ответит в ближайшее время.', 'Ваш вопрос');
  else html = home();
  view.innerHTML = `<div class="view">${html}</div>`;
  bind(r);
}
window.addEventListener('hashchange', route);

/* ---------- Экраны ---------- */
function city() {
  return `<section class="hero"><h1>Привет!<br><span class="red">Где ты сейчас?</span></h1><p>Выбери город — покажем актуальную афишу</p></section>
  <div class="grid" style="margin-top:20px"><div class="tile red" data-city="phuket"><span class="h">Пхукет</span><small>афиша, игры, события</small></div>
  <div class="tile" data-city="spb"><span class="h">Санкт-Петербург</span><small>скоро</small></div></div>`;
}
function spb() {
  return `<h1>Санкт-Петербург<br><span class="red">скоро</span></h1><p class="mute">Мы ещё готовим игры в вашем городе. Следите за новостями в Instagram.</p>
  <button class="btn ghost" data-ig>Instagram @game.phuket</button><button class="btn ghost" data-city="phuket">Перейти к Пхукету</button>`;
}
function home() {
  return `
  <section class="hero">
    <h1>Мафия-клуб<br><span class="red">на Пхукете</span></h1>
    <p>Игры · Тематические вечера · Частные события</p>
  </section>
  <div class="stats"><div><b>2500+</b><span>участников</span></div><div><b>5</b><span>вечеров в неделю</span></div><div><b>0฿</b><span>Community Day</span></div></div>
  <div class="stories">
    ${[['📅', 'Запись', 'events'], ['💬', 'Отзывы', 'toast'], ['👥', 'Гости', 'toast'], ['🎭', 'Роли', 'toast'], ['🎉', 'Частные', 'private-games'], ['🤝', 'Партнёры', 'coop']]
      .map(([i, t, a]) => `<div class="story" data-go="${a}"><i>${i}</i>${t}</div>`).join('')}
  </div>
  <h2 id="events">Афиша <span class="red">4–8 ноября</span></h2>
  ${Object.entries(EVENTS).map(([k, e]) => `
    <div class="card ${e.blue ? 'blue' : ''}" data-go="event-${k}">
      <div class="day">${e.day}</div><div class="name">${e.name}</div>
      <div class="meta">${e.time} · ${e.place}</div>
    </div>`).join('')}
  <h2>Для вас</h2>
  <div class="grid">
    <div class="tile red" data-go="private-mafia"><span class="h">Заказать Мафию</span><small>с ведущим на ваш праздник</small></div>
    <div class="tile" data-go="private-games"><span class="h">Игры под ключ</span><small>день рождения, корпоратив</small></div>
    <div class="tile" data-go="coop"><span class="h">Сотрудничество</span><small>партнёры и спонсоры</small></div>
    <div class="tile" data-go="ask"><span class="h">Задать вопрос</span><small>ответим в чате</small></div>
  </div>
  <button class="btn ghost" data-ig>Instagram @game.phuket</button>`;
}
function event(id) {
  const e = EVENTS[id];
  return `
  <div class="h ${e.blue ? 'blue' : 'red'}" style="font-size:16px">${e.day}</div>
  <h1 style="margin:6px 0 12px">${e.name}</h1>
  <p class="mute">${e.desc}</p>
  <div class="info">
    <div><span>📅 Когда</span>Каждую неделю · ${e.day.toLowerCase()}, ${e.time}</div>
    <div><span>📍 Где</span>${e.place}</div>
    <div><span>💰 Стоимость участия</span>${e.price}</div>
    <div><span>⏳ Продолжительность</span>${e.dur}</div>
  </div>
  <button class="btn ghost" data-go="ask">Задать вопрос</button>`;
}
function form(title, text, ph, games) {
  return `
  <h1 style="margin-bottom:10px">${title}</h1>
  <p class="mute">${text}</p>
  ${games ? `<h2>Что проводим</h2>${Object.entries(GAMES).map(([g, l]) => `<div class="chips" style="margin-bottom:4px"><b>${g}</b></div><ul class="list">${l.map((x) => `<li>• ${x}</li>`).join('')}</ul>`).join('')}` : ''}
  <input id="f-name" placeholder="Имя" value="${tg?.initDataUnsafe?.user?.first_name || ''}">
  <input id="f-contact" placeholder="Телефон или @username" value="${tg?.initDataUnsafe?.user?.username ? '@' + tg.initDataUnsafe.user.username : ''}">
  <textarea id="f-msg" rows="4" placeholder="${ph}"></textarea>`;
}
function eventCTA(id) { return () => sent(`${EVENTS[id].day} — ${EVENTS[id].name}`); }

function bind(r) {
  view.querySelectorAll('[data-city]').forEach((el) => el.addEventListener('click', () => {
    haptic();
    if (el.dataset.city === 'phuket') { localStorage.city = 'phuket'; go('home'); if (!location.hash) route(); } else go('spb');
  }));
  view.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => {
    haptic();
    const t = el.dataset.go;
    if (t === 'events') return $('#events').scrollIntoView({ behavior: 'smooth' });
    if (t === 'toast') return toast('Скоро в мини-аппе');
    go(t);
  }));
  view.querySelector('[data-ig]')?.addEventListener('click', () => { const u = 'https://instagram.com/game.phuket'; tg ? tg.openLink(u) : open(u); });
  const [kind, id] = r.split('-');
  if (kind === 'event' && EVENTS[id]) setMain('Записаться на мероприятие', eventCTA(id));
  else if (['private-mafia', 'private-games', 'coop', 'ask'].includes(r)) {
    setMain('Отправить', () => {
      if (!$('#f-name').value.trim() || !$('#f-contact').value.trim()) { tg?.HapticFeedback?.notificationOccurred('error'); return toast('Заполните имя и контакт'); }
      sent($('h1').textContent);
    });
  }
}

initTelegram();
route();
