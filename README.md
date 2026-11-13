# SeekerWeb

Сайт Seeker: лендинг, тарифы и панель управления с входом в аккаунт Seeker через Google.
Авторизация — Supabase Auth (проект `yvnqvdyhrmrzxdwhnydc`).

## Заметки

- Открывайте файлы во вкладке «Файлы».
- Просите Seeker v1 изменить код во вкладке «Seeker v1».

## Вход в аккаунт Seeker (Google + Supabase)

Поток: кнопка «Панель управления» → `dashboard.html` → карточка входа →
«Продолжить с Google» → `accounts.google.com` → возврат на сайт с сессией →
панель управления с именем, почтой и аватаркой из Google.

Файлы:

| Файл | Назначение |
| --- | --- |
| `assets/js/supabase-config.js` | URL проекта и публичный publishable-ключ |
| `assets/js/supabase-client.js` | Единый клиент Supabase (сессия, вход, выход, профиль) |
| `assets/js/auth.js` | Гейт на странице: показывает вход или защищённый контент |
| `dashboard.html` | `#authGate` (вход) и `#dashApp` (панель после входа) |

Публичный ключ (`sb_publishable_…`) безопасен для браузера: доступ к данным
ограничивают RLS-политики. Service/secret ключи в клиентский код не кладём.

### Что включить в Supabase (один раз, в браузере)

1. **Authentication → Providers → Google** — включить, вставить Client ID и
   Client Secret из Google Cloud Console (OAuth 2.0 Client ID типа Web application).
2. **Google Cloud Console → Authorized redirect URIs** — добавить адрес callback
   Supabase: `https://yvnqvdyhrmrzxdwhnydc.supabase.co/auth/v1/callback`.
3. **Authentication → URL Configuration**:
   - Site URL: адрес сайта, например `https://seeker.ru`;
   - Redirect URLs: адреса возврата, которые разрешены:
     - `http://localhost:5500/**` — локальная проверка через `start-server.cmd`;
     - `https://seeker.ru/**` — боевой домен (подставьте свой).
4. Профиль (имя, аватар) приходит из Google — отдельная таблица не нужна.
   Если понадобятся свои данные (тариф, лимит токенов), создайте таблицу
   `profiles` с колонкой `id uuid references auth.users` и RLS-политикой
   «пользователь видит и правит только свою строку».

### Как проверить локально

1. Запустите `start-server.cmd` (нужен Python) — откроется
   `http://localhost:5500/dashboard.html`.
2. Открывать страницы через `file://` бесполезно: OAuth требует http(s),
   скрипт покажет об этом сообщение.
3. Если после возврата из Google видите ошибку про redirect — адрес из текста
   ошибки нужно добавить в Redirect URLs (шаг 3).
