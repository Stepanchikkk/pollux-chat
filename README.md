# Gemini Chat

Чат-интерфейс для Google Gemini API. Поддерживает текст, изображения, множественные чаты, streaming ответы.

## Возможности

- 💬 Чат с Gemini (текст + изображения)
- 📁 Множественные чаты с историей (IndexedDB)
- ⚡ Streaming ответы
- 🔄 Динамическая загрузка моделей
- 🌙 Тёмная/светлая тема
- 📱 Адаптивный дизайн
- 🔑 BYOK (Bring Your Own Key)

## Tech Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js, Express
- **AI:** Google Gemini API
- **Storage:** IndexedDB (Dexie.js)

---

## Разработка

### Требования

- Node.js 20+
- Google API Key ([получить здесь](https://aistudio.google.com/apikey))

### Установка

```bash
# Клонировать репозиторий
git clone <https://github.com/Stepanchikkk/pollux-chat>
cd gemini-chat

# Установить зависимости
npm run install:all

# Настроить переменные окружения
cp server/.env.example server/.env
# Отредактировать server/.env — добавить GOOGLE_API_KEY
```

### Запуск

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

---

## Production (VPS)

### 1. Подготовка сервера

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
npm install -g pm2
```

### 2. Деплой

```bash
# Клонировать
git clone <https://github.com/Stepanchikkk/pollux-chat>
cd gemini-chat

# Установить зависимости
npm run install:all

# Настроить .env
cp server/.env.example server/.env
nano server/.env  # добавить GOOGLE_API_KEY

# Собрать фронтенд
npm run build

# Запустить через PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 3. Reverse Proxy

#### Nginx

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# SSL (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

#### Caddy

```
yourdomain.com {
    reverse_proxy localhost:3001
}
```

Caddy автоматически настраивает HTTPS.

### 4. DNS

Создайте A-запись: `yourdomain.com → IP вашего сервера`

---

## Переменные окружения

| Переменная | Описание | Обязательно |
|------------|----------|-------------|
| `GOOGLE_API_KEY` | API ключ Google Gemini | Да |
| `PORT` | Порт сервера (по умолчанию 3001) | Нет |
| `HTTPS_PROXY` | Прокси для обхода блокировок | Нет |

---

## Структура проекта

```
gemini-chat/
├── src/                    # React приложение
│   ├── App.tsx            # Главный компонент
│   ├── types.ts           # TypeScript типы
│   └── hooks/             # React хуки
├── server/                 # Express сервер
│   ├── server.js          # API endpoints
│   └── .env.example       # Шаблон конфига
├── dist/                   # Собранный фронтенд (git-ignored)
├── ecosystem.config.cjs    # PM2 конфиг
└── package.json           # Скрипты и зависимости
```

---

## Команды

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск в режиме разработки |
| `npm run build` | Сборка фронтенда |
| `npm start` | Запуск продакшен сервера |
| `npm run install:all` | Установка всех зависимостей |

---

## License

MIT
