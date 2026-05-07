# Beky's Cake Web (Supabase-first)

Sitio web y CRM de Beky's Cake con frontend estatico (HTML/CSS/JS) y backend en Supabase Edge Functions.

## Estado actual de arquitectura
- Pedidos y cotizaciones publicas: Supabase (`submit-order`, `submit-quote`).
- CRM: Supabase (`crm-orders`) con sesion `Bearer` de Supabase Auth.
- Login CRM: Supabase Auth (email/password) con soporte de `usuario o correo`.
- Pagos: PayPal + Supabase Functions (`paypal-create-order`, `paypal-capture-order`).

## Archivos clave
- `index.html`: vista cliente.
- `crm.html`: vista CRM.
- `js/main.js`: flujo cliente (pedido/cotizacion/tracking).
- `js/crm.js`: flujo CRM (login, panel, pedidos, cotizaciones).
- `js/firebase-client.js`: cliente de datos/autenticacion (nombre legacy, implementacion actual en Supabase).
- `supabase/functions/*`: funciones Edge.
- `supabase/migrations/*`: esquema SQL y hardening.
- `docs/paypal-supabase-setup.md`: guia completa PayPal + Supabase.

## Requisitos de meta tags (index y crm)
Debes tener estos meta tags configurados:

```html
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

## Deploy de funciones
```bash
supabase functions deploy paypal-create-order --no-verify-jwt
supabase functions deploy paypal-capture-order --no-verify-jwt
supabase functions deploy submit-order --no-verify-jwt
supabase functions deploy submit-quote --no-verify-jwt
supabase functions deploy crm-orders --no-verify-jwt
supabase functions deploy customer-track-orders --no-verify-jwt
supabase functions deploy customer-update-order-notes --no-verify-jwt
supabase functions deploy resolve-crm-identity --no-verify-jwt
```

## Push CRM (Firebase)
1. En `crm.html`, define tu VAPID en:
```html
<meta name="firebase-vapid-key" content="TU_VAPID_PUBLIC_KEY" />
```
2. En Supabase, agrega el service account de Firebase para FCM HTTP v1 (recomendado):
```bash
supabase secrets set FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```
Alternativas aceptadas:
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_SERVER_KEY` o `FCM_SERVER_KEY` (legacy, no recomendado)

## Nota
El login CRM no depende de Firebase Auth; las notificaciones usan FCM + tokens guardados en Supabase.
