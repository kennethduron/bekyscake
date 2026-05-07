-- CRM users setup template
-- 1) First, create Auth users in Supabase Dashboard:
--    Authentication -> Users -> Add user (email + password)
-- 2) Then run this file in SQL Editor.

begin;

-- Replace with your real users
select * from public.upsert_crm_user_by_email(
  'owner@bekyscake.com',
  'owner',
  'owner',
  true
);

select * from public.upsert_crm_user_by_email(
  'admin@bekyscake.com',
  'admin',
  'admin',
  true
);

select * from public.upsert_crm_user_by_email(
  'rep1@bekyscake.com',
  'rep1',
  'agent',
  true
);

select * from public.upsert_crm_user_by_email(
  'rep2@bekyscake.com',
  'rep2',
  'agent',
  true
);

commit;

-- Verify result
select
  u.id,
  lower(u.email) as auth_email,
  cu.username,
  cu.role,
  cu.is_active,
  cu.created_at
from auth.users u
left join public.crm_users cu on cu.id = u.id
order by u.created_at desc
limit 100;

-- Optional: list Auth users not mapped to crm_users yet
select
  u.id,
  lower(u.email) as auth_email,
  u.created_at
from auth.users u
left join public.crm_users cu on cu.id = u.id
where cu.id is null
order by u.created_at desc;
