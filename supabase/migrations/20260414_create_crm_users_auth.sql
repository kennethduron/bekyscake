create table if not exists public.crm_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text not null,
  role text not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_users_role_chk check (role in ('owner', 'admin', 'agent', 'viewer')),
  constraint crm_users_username_chk check (username ~ '^[a-z0-9._-]{3,40}$')
);

create unique index if not exists idx_crm_users_email_lower_unique
  on public.crm_users ((lower(email)));

create unique index if not exists idx_crm_users_username_lower_unique
  on public.crm_users ((lower(username)));

create or replace function public.normalize_crm_user_identity()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(coalesce(new.email, '')));
  new.username := lower(trim(coalesce(new.username, '')));
  new.role := lower(trim(coalesce(new.role, 'agent')));
  return new;
end;
$$;

drop trigger if exists trg_crm_users_normalize_identity on public.crm_users;
create trigger trg_crm_users_normalize_identity
before insert or update on public.crm_users
for each row
execute function public.normalize_crm_user_identity();

drop trigger if exists trg_crm_users_set_updated_at on public.crm_users;
create trigger trg_crm_users_set_updated_at
before update on public.crm_users
for each row
execute function public.set_updated_at();

alter table public.crm_users enable row level security;

drop policy if exists "deny_all_crm_users" on public.crm_users;
create policy "deny_all_crm_users"
  on public.crm_users
  for all
  using (false)
  with check (false);

create or replace function public.upsert_crm_user_by_email(
  p_email text,
  p_username text,
  p_role text default 'agent',
  p_is_active boolean default true
)
returns table (
  id uuid,
  email text,
  username text,
  role text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email text;
  v_username text;
  v_role text;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  v_username := lower(trim(coalesce(p_username, '')));
  v_role := lower(trim(coalesce(p_role, 'agent')));

  if v_email = '' then
    raise exception 'email requerido.';
  end if;
  if v_username = '' then
    raise exception 'username requerido.';
  end if;
  if v_role not in ('owner', 'admin', 'agent', 'viewer') then
    raise exception 'rol no permitido.';
  end if;

  select u.id
    into v_user_id
    from auth.users u
   where lower(coalesce(u.email, '')) = v_email
   limit 1;

  if v_user_id is null then
    raise exception 'No existe un usuario Auth con ese email.';
  end if;

  insert into public.crm_users (id, email, username, role, is_active)
  values (v_user_id, v_email, v_username, v_role, coalesce(p_is_active, true))
  on conflict (id)
  do update set
    email = excluded.email,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    updated_at = now();

  return query
  select cu.id, cu.email, cu.username, cu.role, cu.is_active
    from public.crm_users cu
   where cu.id = v_user_id;
end;
$$;

revoke all on function public.upsert_crm_user_by_email(text, text, text, boolean) from public;
grant execute on function public.upsert_crm_user_by_email(text, text, text, boolean) to service_role;
