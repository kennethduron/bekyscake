# Beky's Cake Web (Vercel + Supabase)

Sitio web y CRM de Beky's Cake con frontend estatico (HTML/CSS/JS), backend publico en Vercel Functions y datos/auth en Supabase.

## Estado actual de arquitectura
- Pedidos y cotizaciones publicas: Vercel (`/api/submit-order`, `/api/submit-quote`).
- CRM: Supabase (`crm-orders`) con sesion `Bearer` de Supabase Auth.
- Login CRM: Supabase Auth (email/password) con soporte de `usuario o correo`.
- Pagos: PayPal desde Vercel (`/api/paypal-create-order`, `/api/paypal-capture-order`).
- Notificaciones: Firebase Cloud Messaging desde Vercel al CRM cuando entra una orden/cotizacion.

## Archivos clave
- `index.html`: vista cliente.
- `crm.html`: vista CRM.
- `js/main.js`: flujo cliente (pedido/cotizacion/tracking).
- `js/crm.js`: flujo CRM (login, panel, pedidos, cotizaciones).
- `js/firebase-client.js`: cliente de datos/autenticacion (nombre legacy, implementacion actual en Supabase).
- `api/*`: Vercel Functions para pedidos, pagos, tracking publico y push FCM.
- `supabase/functions/*`: funciones Edge.
- `supabase/migrations/*`: esquema SQL y hardening.
- `docs/paypal-supabase-setup.md`: guia completa PayPal + Supabase.

## Requisitos de meta tags (index y crm)
Debes tener estos meta tags configurados:

```html
<meta name="backend-api-url" content="/api" />
<meta name="supabase-functions-url" content="https://TU-PROYECTO.supabase.co/functions/v1" />
<meta name="supabase-anon-key" content="TU_SUPABASE_ANON_KEY" />
```

Opcional (si no esta, se deriva desde `supabase-functions-url`):

```html
<meta name="supabase-url" content="https://TU-PROYECTO.supabase.co" />
```

## Migraciones requeridas
Ejecuta:

```bash
supabase db push
```

Incluye al menos:
- `20260412_add_request_rate_limits.sql`
- `20260413_create_orders_quotes_and_harden_paypal_intents.sql`
- `20260414_create_crm_users_auth.sql`
- `20260415_create_crm_notification_tokens.sql`

## Como crear usuarios CRM (sin Firebase)
1. En Supabase Dashboard, crea usuario en `Authentication > Users` con email y password.
2. En SQL Editor, asigna usuario CRM con:

```sql
select * from public.upsert_crm_user_by_email(
  'agente@tudominio.com',
  'agente1',
  'agent',
  true
);
```

Roles permitidos: `owner`, `admin`, `agent`, `viewer`.

## Variables de entorno en Vercel
Configura estos secretos en Vercel Project Settings > Environment Variables:

```bash
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_ENV=sandbox
PAYPAL_CURRENCY=USD
PAYPAL_USD_RATE=0.0405
PAYMENT_ALLOWED_ORIGIN=https://TU-DOMINIO
CRM_URL=https://TU-DOMINIO/crm
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FCM_ICON_URL=https://TU-DOMINIO/assets/bekys_icon.png
```

`PAYPAL_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` y `FCM_SERVICE_ACCOUNT_JSON` nunca deben ir en HTML ni JS publico.

## Push CRM (Firebase)
1. En `crm.html`, define tu VAPID en:
```html
<meta name="firebase-vapid-key" content="TU_VAPID_PUBLIC_KEY" />
```
2. En Vercel, agrega el service account de Firebase para FCM HTTP v1:
```bash
FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```
Alternativas aceptadas:
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
3. En el celular del rep:
- Android/Chrome: abre `/crm` en HTTPS, inicia sesion y toca `Activar notificaciones`.
- iPhone: abre `/crm` en Safari, agrega el CRM a la pantalla de inicio, abre ese icono, inicia sesion y toca `Activar notificaciones`.
- Despues de activarlas, pueden llegar aunque el CRM este cerrado o el celular bloqueado.

## Nota
El login CRM no depende de Firebase Auth; las notificaciones usan FCM + tokens guardados en Supabase.
