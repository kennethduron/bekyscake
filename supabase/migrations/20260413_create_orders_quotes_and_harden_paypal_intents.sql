create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  client_order_id text not null unique,
  tracking_key text not null unique,
  display_id text not null,
  local_number text not null,
  client text not null,
  phone text not null,
  notes text not null default '',
  customer_notes_edited boolean not null default false,
  customer_notes_edited_at timestamptz,
  notes_updated_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  total_hnl numeric(12,2) not null default 0,
  payment_method text not null,
  payment_status text not null,
  payment_provider text not null default 'manual',
  paypal_internal_order_id text,
  paypal_order_id text,
  paypal_capture_id text,
  payment_currency text,
  payment_amount numeric(12,2) not null default 0,
  paid_at timestamptz,
  status text not null default 'Pendiente',
  order_time text not null,
  created_at_local timestamptz not null default now(),
  order_date date not null,
  delivered_at timestamptz,
  rejected_at timestamptz,
  source text not null default 'web',
  source_origin text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_hnl_non_negative check (total_hnl >= 0),
  constraint orders_payment_amount_non_negative check (payment_amount >= 0),
  constraint orders_payment_method_chk check (payment_method in ('paypal', 'pay_later')),
  constraint orders_payment_status_chk check (payment_status in ('paid', 'pending'))
);

create unique index if not exists idx_orders_paypal_capture_id_unique
  on public.orders (paypal_capture_id)
  where paypal_capture_id is not null and length(trim(paypal_capture_id)) > 0;

create unique index if not exists idx_orders_paypal_internal_order_id_unique
  on public.orders (paypal_internal_order_id)
  where paypal_internal_order_id is not null and length(trim(paypal_internal_order_id)) > 0;

create index if not exists idx_orders_tracking_key on public.orders (tracking_key);
create index if not exists idx_orders_created_at on public.orders (created_at desc);

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

alter table public.orders enable row level security;

drop policy if exists "deny_all_orders" on public.orders;
create policy "deny_all_orders"
  on public.orders
  for all
  using (false)
  with check (false);

create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text not null default '',
  event_date date,
  details text not null,
  status text not null default 'Nueva',
  source text not null default 'web',
  source_origin text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quotes_created_at on public.quotes (created_at desc);
create index if not exists idx_quotes_status on public.quotes (status);

drop trigger if exists trg_quotes_set_updated_at on public.quotes;
create trigger trg_quotes_set_updated_at
before update on public.quotes
for each row
execute function public.set_updated_at();

alter table public.quotes enable row level security;

drop policy if exists "deny_all_quotes" on public.quotes;
create policy "deny_all_quotes"
  on public.quotes
  for all
  using (false)
  with check (false);

alter table public.paypal_order_intents
  add column if not exists submitted_order_id text,
  add column if not exists submitted_tracking_key text,
  add column if not exists submitted_at timestamptz;

create unique index if not exists idx_paypal_order_intents_submitted_order_id_unique
  on public.paypal_order_intents (submitted_order_id)
  where submitted_order_id is not null and length(trim(submitted_order_id)) > 0;

create unique index if not exists idx_paypal_order_intents_submitted_tracking_key_unique
  on public.paypal_order_intents (submitted_tracking_key)
  where submitted_tracking_key is not null and length(trim(submitted_tracking_key)) > 0;
