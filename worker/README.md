# API для мини-аппа на Cloudflare Workers (бесплатно)

Хранит города и афишу в Workers KV. Работает постоянно, компьютер не нужен.

```bash
cd worker
npx wrangler@3 login                       # откроется браузер, войти в cloudflare.com
npx wrangler@3 kv namespace create CONFIG  # вывести id и вписать его в wrangler.toml
npx wrangler@3 secret put BOT_TOKEN        # вставить токен бота (вводится скрыто)
npx wrangler@3 secret put ADMIN_IDS        # Telegram ID админов через запятую (узнать: /id у бота)
npx wrangler@3 secret put CITY_MANAGERS    # менеджеры городов: phuket:ID,bali:ID (несколько ID через |) — заявки приходят им в личку
npx wrangler@3 secret put STAFF_IDS        # кому ещё показывать вкладку «Админ» (ID через запятую)
npx wrangler@3 secret put GP_API_KEY       # ключ API клуба GamePhuket (адрес — GP_API_URL в wrangler.toml; из него загружается афиша Пхукета)
npx wrangler@3 deploy                      # покажет адрес https://game-phuket-api.<имя>.workers.dev
```

Затем впишите этот адрес в `docs/config.js` (`window.GP_API = '...'`) и запушьте — сайт на GitHub Pages начнёт сохранять данные через Worker.

Используйте `wrangler@3`: свежие версии требуют Node 22.
