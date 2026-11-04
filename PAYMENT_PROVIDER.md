# Подключение платёжной кассы FlowTix

Платёжный провайдер пока не задан. Кассовый поток включается только после настройки всех серверных переменных; если их нет, сайт оставляет оплату с баланса. Значение «Визуальные платежи» в админке не меняется и не используется как подтверждение реального платежа.

## Переменные Render для сервиса API

- `PAYMENT_PROVIDER_NAME` — короткий идентификатор провайдера, например `provider_x`.
- `PAYMENT_PROVIDER_CREATE_URL` — HTTPS endpoint создания платежа.
- `PAYMENT_PROVIDER_API_KEY` — секрет API провайдера.
- `PAYMENT_WEBHOOK_SECRET` — отдельный секрет для подписи callback.
- `PUBLIC_SITE_URL` — URL сайта, по умолчанию `https://flowtix.online`.
- `RENDER_EXTERNAL_URL` Render предоставляет автоматически; он используется для webhook URL. Если не задан, укажите `PAYMENT_WEBHOOK_URL` с публичным HTTPS URL сервера.

Не помещайте API key или webhook secret во frontend, GitHub-файлы или ответы API.

## Контракт создания платежа

FlowTix отправляет на `PAYMENT_PROVIDER_CREATE_URL` запрос `POST` с заголовками `Authorization: Bearer <API_KEY>`, `Idempotency-Key` и JSON:

```json
{
  "merchant_reference": "<UUID payment_intents.id>",
  "amount": 777,
  "currency": "KZT",
  "description": "Билет FlowTix",
  "return_url": "https://flowtix.online/?paymentIntent=<UUID>",
  "webhook_url": "https://<render-service>.onrender.com/api/webhooks/payments"
}
```

Успешный ответ провайдера должен содержать:

```json
{
  "provider_reference": "<ID платежа у провайдера>",
  "checkout_url": "https://<hosted-checkout-url>"
}
```

FlowTix принимает только HTTPS-ссылку на форму оплаты. Перед переходом место резервируется на 15 минут.

## Контракт webhook

Провайдер отправляет JSON на `/api/webhooks/payments`. Заголовок `X-FlowTix-Signature` должен содержать hex HMAC-SHA256 от точных байтов тела запроса с `PAYMENT_WEBHOOK_SECRET`; допустим формат `sha256=<hex>`.

Пример успешного callback:

```json
{
  "merchant_reference": "<тот же UUID FlowTix>",
  "provider_reference": "<тот же ID провайдера из ответа создания>",
  "status": "paid",
  "amount": 777,
  "currency": "KZT"
}
```

Поддерживаются статусы `paid` / `completed` и `failed` / `cancelled`. FlowTix сверяет подпись, сумму, валюту, срок брони и идентификатор провайдера. Только после успешной проверки сервер атомарно создаёт регистрацию, платёж и билет с QR-кодом. Повторный callback с теми же реквизитами безопасен. Незавершённые платежи истекают через 15 минут, бронь освобождается фоновой задачей API.

Перед запуском нужно адаптировать endpoint и формат callback конкретной кассы (например, её статус-коды и способ подписи). Универсальный транспорт и безопасная серверная проверка уже реализованы.
