create table if not exists public.request_rate_limits (
  limit_key text primary key,
  action text not null,
  fingerprint_hash text not null,
  bucket bigint not null,
  count integer not null default 1,
  expire_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_request_rate_limits_expire_at
  on public.request_rate_limits (expire_at);

alter table public.request_rate_limits enable row level security;

drop policy if exists "deny_all_request_rate_limits" on public.request_rate_limits;
create policy "deny_all_request_rate_limits"
  on public.request_rate_limits
  for all
  using (false)
  with check (false);

create or replace function public.enforce_request_rate_limit(
  p_action text,
  p_fingerprint_hash text,
  p_bucket bigint,
  p_max_requests integer,
  p_window_seconds integer default 600
)
returns table (allowed boolean, current_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_now timestamptz := now();
  v_expire timestamptz;
  v_count integer;
begin
  if p_action is null or length(trim(p_action)) = 0 then
    return query select false, 0;
    return;
  end if;

  if p_max_requests is null or p_max_requests < 1 then
    return query select false, 0;
    return;
  end if;

  if p_window_seconds is null or p_window_seconds < 30 then
    p_window_seconds := 600;
  end if;

  v_expire := v_now + make_interval(secs => p_window_seconds);
  v_key := trim(p_action) || ':' || trim(coalesce(p_fingerprint_hash, 'unknown')) || ':' || p_bucket::text;

  insert into public.request_rate_limits (
    limit_key,
    action,
    fingerprint_hash,
    bucket,
    count,
    expire_at,
    created_at,
    updated_at
  )
  values (
    v_key,
    trim(p_action),
    trim(coalesce(p_fingerprint_hash, 'unknown')),
    p_bucket,
    1,
    v_expire,
    v_now,
    v_now
  )
  on conflict (limit_key)
  do update
  set
    count = public.request_rate_limits.count + 1,
    expire_at = v_expire,
    updated_at = v_now
  returning public.request_rate_limits.count into v_count;

  if random() < 0.02 then
    delete from public.request_rate_limits
    where expire_at < now();
  end if;

  return query select v_count <= p_max_requests, v_count;
end;
$$;

revoke all on function public.enforce_request_rate_limit(text, text, bigint, integer, integer) from public;
grant execute on function public.enforce_request_rate_limit(text, text, bigint, integer, integer) to service_role;
