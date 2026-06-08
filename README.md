# Image to SVG — Конвертер иконок и favicon

Веб-сервис для конвертации PNG/JPEG изображений в редактируемый SVG с удалением фона и генерацией favicon.

**Демо:** [image-to-svg.vercel.app](https://image-to-svg.vercel.app/)

## Возможности

- **Конвертация растровых изображений в SVG** — три режима векторизации:
  - **Иконка** — чистый монохромный контур с бинарным порогом, идеально для иконок и логотипов
  - **Плакат** — цветные слои с плавными контурами (2–12 цветов), подходит для иллюстраций
  - **Детальная** — максимальная детализация цвета (до 64 цветов), для фотографий и сложных изображений
- **Удаление фона** — автоматическое определение цвета фона по краям изображения с настраиваемой чувствительностью
- **Редактор SVG** — просмотр и редактирование SVG-кода в реальном времени
- **Режим сравнения** — side-by-side просмотр оригинала и результата
- **Генератор Favicon** — создание полного набора favicon из полученного SVG:
  - SVG favicon
  - ICO favicon (16×16, 32×32, 48×48)
  - Android Chrome 192×192 PNG
  - Apple Touch Icon 180×180 PNG
  - Favicon 96×96 PNG
  - Favicon 32×32 PNG
- **Расширенные настройки** — контроль количества цветов, масштаба, сглаживания, точности линий и кривых

## Технологии

- **Next.js 16** (App Router, Serverless Functions)
- **sharp** — предобработка изображений (resize, blur, grayscale, threshold, edge smoothing)
- **imagetracerjs** — растровая векторизация с квантованием цветов
- **Tailwind CSS 4** + **shadcn/ui** — интерфейс
- **Vercel** — хостинг и деплой

## Как использовать

1. Загрузите PNG или JPEG изображение (drag & drop или выбор файла)
2. Выберите режим конвертации (Иконка / Плакат / Детальная)
3. При необходимости включите удаление фона и настройте чувствительность
4. Нажмите «Конвертировать в SVG»
5. Просмотрите результат, отредактируйте SVG-код, скачайте файл
6. Нажмите «Создать Favicon» для генерации полного набора favicon

## Локальная разработка

```bash
# Клонирование
git clone https://github.com/Mmitekk/image-to-svg.git
cd image-to-svg

# Установка зависимостей
npm install

# Запуск dev-сервера
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Деплой на Vercel

Проект автоматически деплоится на Vercel при push в ветку `main`.

Для ручного деплоя:

```bash
# Установить Vercel CLI
npm i -g vercel

# Деплой
vercel --prod
```

## Структура проекта

```
src/
├── app/
│   ├── api/
│   │   ├── convert/
│   │   │   └── route.ts      # API конвертации изображений в SVG
│   │   └── favicon/
│   │       └── route.ts      # API генерации favicon
│   ├── layout.tsx
│   ├── page.tsx               # Главная страница (SPA)
│   └── globals.css
├── components/ui/             # shadcn/ui компоненты
└── lib/
    └── utils.ts
```

## API

### POST /api/convert

Конвертация изображения в SVG.

**Запрос:** `multipart/form-data`

| Поле | Тип | Описание |
|------|-----|----------|
| `image` | File | PNG или JPEG изображение |
| `options` | JSON string | Параметры конвертации |

**Опции:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `mode` | string | `"poster"` | Режим: `icon`, `poster`, `detailed` |
| `removeBg` | boolean | `false` | Удалить фон |
| `bgColorTolerance` | number | `0.15` | Чувствительность удаления фона (0–0.5) |
| `numberOfColors` | number | `8` | Количество цветов (2–64) |
| `scale` | number | `1` | Масштаб (0.5–4) |
| `ltres` | number | `1.0` | Точность линий |
| `qtres` | number | `1.0` | Точность кривых |
| `pathOmit` | number | `8` | Мин. размер пути (убрать шум) |

**Ответ:**

```json
{
  "svg": "<svg>...</svg>",
  "width": 800,
  "height": 600,
  "originalWidth": 1920,
  "originalHeight": 1080,
  "mode": "poster"
}
```

### POST /api/favicon

Генерация favicon из SVG.

**Запрос:** `application/json`

```json
{
  "svg": "<svg>...</svg>",
  "formats": ["svg-favicon", "ico-favicon", "android-192", "apple-touch", "favicon-96", "favicon-32"]
}
```

**Ответ:**

```json
{
  "favicons": {
    "svg-favicon": { "data": "...", "mimeType": "image/svg+xml", "filename": "favicon.svg", "label": "SVG Favicon" },
    "ico-favicon": { "data": "...", "mimeType": "image/x-icon", "filename": "favicon.ico", "label": "ICO Favicon" },
    "android-192": { "data": "...", "mimeType": "image/png", "filename": "android-chrome-192x192.png", "label": "Android PNG 192x192" },
    ...
  }
}
```

Все данные возвращаются в base64.

## Лицензия

MIT
