# PayPal + Supabase (flujo seguro)

## 1) Lo que ya hace este proyecto
- Muestra modal al confirmar pedido con 2 opciones: `Pagar ahora` o `Pagar luego`.
- `Pagar ahora` abre el checkout oficial de PayPal.
- La tarjeta se procesa en PayPal, no en tu frontend.
- La creacion y captura del pago se hace en Supabase Edge Functions:
  - `paypal-create-order`
  - `paypal-capture-order`
- El guardado final de pedidos/cotizaciones tambien corre en Supabase:
  - `submit-order`
  - `submit-quote`
- El CRM y tracking cliente corren en Supabase:
  - `crm-orders`
  - `customer-track-orders`
  - `customer-update-order-notes`

## 2) Configuracion en `index.html` y `crm.html`
Llena estos `meta` con tus datos:

```html
<meta name="supabase-functions-url" content="https://TU-PROYECTO.supabase.co/functions/v1" />
<meta name="supabase-anon-key" content="TU_SUPABASE_ANON_KEY" />
<meta name="supabase-url" content="https://TU-PROYECTO.supabase.co" />
<meta name="paypal-client-id" content="TU_CLIENT_ID_PAYPAL" />
<meta name="paypal-currency" content="USD" />
<meta name="paypal-usd-rate" content="0.0405" />
```

`paypal-usd-rate` en frontend es solo estimado visual antes de abrir PayPal.  
El cobro real lo define backend (Supabase Function) con la tasa vigente.

## 3) Secretos en Supabase
En `Project Settings > Edge Functions > Secrets`, agrega:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENV` = `sandbox` o `live`
- `PAYPAL_CURRENCY` = `USD` (o la que definas)
- `PAYPAL_USD_RATE` = tasa fallback si falla el proveedor en vivo (ejemplo: `0.0405`)
- `PAYPAL_USD_RATE_AUTO` = `true` para tasa en vivo automatica
- `PAYPAL_USD_RATE_API_URL` = proveedor de tasa (ejemplo: `https://open.er-api.com/v6/latest/HNL`)
- `PAYPAL_USD_RATE_API_TIMEOUT_MS` = timeout del proveedor (ejemplo: `5000`)
- `PAYMENT_ALLOWED_ORIGIN` = dominio principal (ejemplo: `https://bekyscake.com`)
- `PAYMENT_ALLOWED_ORIGINS` = opcional, lista separada por comas

## 4) Despliegue de funciones
Desde la carpeta del proyecto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
supabase functions deploy paypal-create-order --no-verify-jwt
supabase functions deploy paypal-capture-order --no-verify-jwt
supabase functions deploy submit-order --no-verify-jwt
supabase functions deploy submit-quote --no-verify-jwt
supabase functions deploy crm-orders --no-verify-jwt
supabase functions deploy customer-track-orders --no-verify-jwt
supabase functions deploy customer-update-order-notes --no-verify-jwt
supabase functions deploy resolve-crm-identity --no-verify-jwt
```

Nota para CRM: `crm-orders` valida sesion Supabase Auth (Bearer JWT) y exige usuario activo en `public.crm_users`.

## 5) Migraciones requeridas
- `supabase/migrations/20260412_add_request_rate_limits.sql`
- `supabase/migrations/20260413_create_orders_quotes_and_harden_paypal_intents.sql`
- `supabase/migrations/20260414_create_crm_users_auth.sql`

## 6) Seguridad minima recomendada
- Nunca guardar numero de tarjeta, CVV o fecha en base de datos.
- Mantener `PAYPAL_CLIENT_SECRET` solo como secreto de backend.
- Registrar solo referencias de pago (order id/capture id, monto, moneda, estado).
- Revisar periodicamente `paypal_order_intents` para auditoria.
- Validar siempre el pedido contra `paypal_order_intents` antes de marcar `paid`.

## 7) Blindaje anti-abuso incluido
- `paypal-create-order` y `paypal-capture-order` validan `Origin`.
- `submit-order` no confia en `paymentStatus` ni `paypalCaptureId` del navegador.
- Se bloquea reutilizacion de `paypal_capture_id` con indice unico en `public.orders`.
- Se aplica rate limit por huella (IP + user agent hash) en ventana de 10 minutos.
- Si existe `enforce_request_rate_limit`, el limite se guarda en base; si no, usa respaldo en memoria.
- Se valida tamano maximo de request.
- El flujo de crear orden usa honeypot (`website`) y tiempo minimo humano (`startedAt`).
