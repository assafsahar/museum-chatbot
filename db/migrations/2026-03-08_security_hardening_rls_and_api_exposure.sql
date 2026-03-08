-- Security hardening for Supabase public schema tables used by server-side functions.
-- Goal:
-- 1) Enable RLS on exposed tables (where applicable)
-- 2) Remove direct API access for anon/authenticated roles
-- Notes:
-- - Netlify functions use service_role and continue to work.
-- - This migration is idempotent and safe to run multiple times.

begin;

do $$
declare
  rel_name text;
  rel_oid oid;
  rel_kind "char";
begin
  -- Keep this list aligned with Security Advisor findings.
  foreach rel_name in array ARRAY[
    'public.analytics_events',
    'public.analytics_daily_rollup',
    'public.analytics_daily_funnel',
    'public.usage_monthly',
    'public.usage_monthly_exhibit',
    'public.usage_quota_policy',
    'public.usage_daily_exhibit'
  ]
  loop
    rel_oid := to_regclass(rel_name);
    if rel_oid is null then
      continue;
    end if;

    select c.relkind
      into rel_kind
    from pg_class c
    where c.oid = rel_oid;

    -- Enable RLS only on real tables / partitioned tables.
    if rel_kind in ('r', 'p') then
      execute format('alter table %s enable row level security', rel_oid::regclass);
    end if;

    -- Remove direct PostgREST exposure for client roles.
    execute format('revoke all privileges on %s from anon, authenticated', rel_oid::regclass);
  end loop;
end $$;

commit;
