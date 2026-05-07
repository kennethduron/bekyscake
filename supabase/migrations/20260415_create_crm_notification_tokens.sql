create table if not exists public.crm_notification_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text not null default '',
  device_label text not null default 'web',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists crm_notification_tokens_user_id_idx
  on public.crm_notification_tokens (user_id);

create index if not exists crm_notification_tokens_enabled_idx
  on public.crm_notification_tokens (enabled)
  where enabled = true;

alter table public.crm_notification_tokens enable row level security;

drop policy if exists crm_notification_tokens_select_own on public.crm_notification_tokens;
create policy crm_notification_tokens_select_own
  on public.crm_notification_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists crm_notification_tokens_insert_own on public.crm_notification_tokens;
create policy crm_notification_tokens_insert_own
  on public.crm_notification_tokens
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists crm_notification_tokens_update_own on public.crm_notification_tokens;
create policy crm_notification_tokens_update_own
  on public.crm_notification_tokens
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists crm_notification_tokens_delete_own on public.crm_notification_tokens;
create policy crm_notification_tokens_delete_own
  on public.crm_notification_tokens
  for delete
  to authenticated
  using (auth.uid() = user_id);

