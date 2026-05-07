create table if not exists public.paypal_order_intents (
  id bigint generated always as identity primary key,
  internal_order_id text not null unique,
  paypal_order_id text unique,
  status text not null default 'created',
  currency text not null,
  total_hnl numeric(12,2) not null default 0,
  total_charge numeric(12,2) not null default 0,
  capture_id text,
  payer_email text,
  cart jsonb not null default '[]'::jsonb,
  customer jsonb not null default '{}'::jsonb,
  paypal_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_paypal_order_intents_paypal_order_id
  on public.paypal_order_intents (paypal_order_id);

create index if not exists idx_paypal_order_intents_status
  on public.paypal_order_intents (status);

alter table public.paypal_order_intents enable row level security;

drop policy if exists "deny_all_paypal_order_intents" on public.paypal_order_intents;
create policy "deny_all_paypal_order_intents"
  on public.paypal_order_intents
  for all
  using (false)
  with check (false);
