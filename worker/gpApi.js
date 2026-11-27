// Клиент API клуба GamePhuket (игры, записи, оплата, заявки). Пока подключён только список игр (афиша).
// Ключ — только в секрете GP_API_KEY; в браузер игрока он не попадает. Игрока клуб определяет по initData.

export class GpApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const gpEnabled = (env) => !!(env.GP_API_URL && env.GP_API_KEY);

async function call(env, path, { method = 'GET', initData, body, idempotencyKey } = {}) {
  if (!gpEnabled(env)) throw new GpApiError(503, 'not_configured', 'API клуба не настроено');
  const headers = { Authorization: `Bearer ${env.GP_API_KEY}` };
  if (initData) headers['X-Telegram-Init-Data'] = initData; // строка как есть
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 64);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(env.GP_API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new GpApiError(502, 'network', 'Нет связи с базой клуба. Попробуйте ещё раз');
  }
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) {
    throw new GpApiError(r.ok ? 502 : r.status, data?.code || 'internal', data?.error || 'Ошибка базы клуба. Попробуйте позже', Number(r.headers.get('Retry-After')) || undefined);
  }
  return data;
}

const id = (x) => {
  const n = Number(x);
  if (!Number.isInteger(n) || n < 1) throw new GpApiError(400, 'bad_request', 'Неверный идентификатор');
  return n;
};

// from/to — «гггг-мм-дд» по Пхукету; без initData в играх не будет my_signup
export function gpGames(env, { from, to, initData } = {}) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return call(env, `/games${q.size ? `?${q}` : ''}`, { initData });
}

// Внимание: заводит нового игрока в базе клуба, если его там нет
export const gpMe = (env, initData) => call(env, '/me', { initData });

// payMethod: cash | thai_bank | rub | usdt | manager; receipt: { data: base64, mime }
export const gpSignup = (env, initData, gameId, { seats, payMethod, receipt }, idempotencyKey) =>
  call(env, `/games/${id(gameId)}/signup`, { method: 'POST', initData, idempotencyKey, body: { seats, pay_method: payMethod, ...(receipt ? { receipt } : {}) } });

export const gpCancel = (env, initData, gameId, idempotencyKey) =>
  call(env, `/games/${id(gameId)}/cancel`, { method: 'POST', initData, idempotencyKey });

// initData здесь должна быть менеджера
export const gpConfirm = (env, initData, signupId, note, idempotencyKey) =>
  call(env, `/signups/${id(signupId)}/confirm`, { method: 'POST', initData, idempotencyKey, body: note ? { note: String(note).slice(0, 300) } : {} });

// kind: question | partnership | order | event
export const gpRequest = (env, initData, { kind, text, contact, lang }, idempotencyKey) =>
  call(env, '/requests', { method: 'POST', initData, idempotencyKey, body: { kind, text: String(text).slice(0, 2000), ...(contact ? { contact: String(contact).slice(0, 200) } : {}), ...(lang ? { lang } : {}) } });

// Чек из формы (File/Blob) → поле receipt. PDF клуб не принимает: только JPEG/PNG/WebP/HEIC до 8 МБ
export async function gpReceipt(file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type)) throw new GpApiError(400, 'bad_request', 'Чек: только фото (JPG, PNG, WebP, HEIC)');
  if (file.size > 8 * 1024 * 1024) throw new GpApiError(413, 'receipt_too_large', 'Чек больше 8 МБ');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), mime: file.type };
}
