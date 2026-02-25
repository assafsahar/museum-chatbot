-- Quota policy + precise quota windows (monthly_anchor/custom) via daily usage aggregates
-- Safe to run on staging first. Most statements are idempotent.

begin;

-- 1) Quota policy table (per museum)
create table if not exists public.usage_quota_policy (
  policy_id bigserial primary key,
  museum_id text not null references public.museums(museum_id) on delete cascade,

  is_active boolean not null default true,
  quota_enabled boolean not null default false,
  block_on_exhaustion boolean not null default false,

  period_type text not null default 'monthly'
    check (period_type in ('monthly', 'yearly', 'custom')),

  quota_limit_questions integer not null default 0
    check (quota_limit_questions >= 0),

  warn_threshold_percent integer not null default 80
    check (warn_threshold_percent between 1 and 100),

  period_start_at timestamptz null,
  period_end_at timestamptz null,

  notes text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (museum_id)
);

-- 2) Enum period type + anchor fields (contract-based month start)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'quota_period_type'
      and n.nspname = 'public'
  ) then
    create type public.quota_period_type as enum (
      'monthly_calendar',
      'monthly_anchor',
      'yearly_calendar',
      'custom'
    );
  end if;
end $$;

-- Normalize legacy values while period_type is text
update public.usage_quota_policy
set period_type = case
  when period_type = 'monthly' then 'monthly_calendar'
  when period_type = 'yearly' then 'yearly_calendar'
  when period_type = 'custom' then 'custom'
  when period_type = 'monthly_calendar' then 'monthly_calendar'
  when period_type = 'monthly_anchor' then 'monthly_anchor'
  when period_type = 'yearly_calendar' then 'yearly_calendar'
  else 'monthly_calendar'
end
where period_type is not null
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usage_quota_policy'
      and column_name = 'period_type'
      and udt_name = 'text'
  );

-- Convert text -> enum only if column is still text
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usage_quota_policy'
      and column_name = 'period_type'
      and udt_name = 'text'
  ) then
    alter table public.usage_quota_policy
      drop constraint if exists usage_quota_policy_period_type_check;

    alter table public.usage_quota_policy
      alter column period_type drop default;

    alter table public.usage_quota_policy
      alter column period_type type public.quota_period_type
      using period_type::public.quota_period_type;
  end if;
end $$;

alter table public.usage_quota_policy
  alter column period_type set default 'monthly_calendar';

alter table public.usage_quota_policy
  add column if not exists anchor_day_of_month integer null
    check (anchor_day_of_month between 1 and 31);

alter table public.usage_quota_policy
  add column if not exists anchor_timezone text null;

-- 3) Daily per-exhibit usage aggregates (supports precise quota windows)
create table if not exists public.usage_daily_exhibit (
  usage_daily_exhibit_id bigserial primary key,
  museum_id text not null references public.museums(museum_id) on delete cascade,
  exhibition_id text null,
  exhibit_id text not null,
  usage_date date not null,
  questions_total integer not null default 0 check (questions_total >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (museum_id, exhibition_id, exhibit_id, usage_date)
);

create index if not exists usage_daily_exhibit_museum_date_idx
  on public.usage_daily_exhibit (museum_id, usage_date);

create index if not exists usage_daily_exhibit_museum_exhibition_date_idx
  on public.usage_daily_exhibit (museum_id, exhibition_id, usage_date);

commit;

-- 4) usage_increment RPC (monthly + monthly_exhibit + daily_exhibit)
begin;

drop function if exists public.usage_increment(
  text,text,text,text,text,integer,integer,integer,numeric,integer,boolean
);

create function public.usage_increment(
  p_museum_id text,
  p_month_key text,
  p_exhibit_id text,
  p_exhibition_id text,
  p_mode text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_openai_cost_usd numeric,
  p_fn_ms integer,
  p_cached boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exhibition_id text;
begin
  v_exhibition_id := coalesce(nullif(p_exhibition_id, ''), 'default_exhibition');

  -- Monthly total (current schema may still be unique on museum_id + month_key)
  insert into public.usage_monthly (
    museum_id, month_key, exhibition_id, questions_total
  )
  values (
    p_museum_id, p_month_key, v_exhibition_id, 1
  )
  on conflict (museum_id, month_key)
  do update set
    questions_total = public.usage_monthly.questions_total + 1;

  if nullif(p_exhibit_id, '') is not null then
    begin
      insert into public.usage_monthly_exhibit (
        museum_id, month_key, exhibition_id, exhibit_id, questions_total
      )
      values (
        p_museum_id, p_month_key, v_exhibition_id, p_exhibit_id, 1
      )
      on conflict (museum_id, month_key, exhibition_id, exhibit_id)
      do update set
        questions_total = public.usage_monthly_exhibit.questions_total + 1;
    exception
      when undefined_column then
        -- Backward compatibility if exhibition_id column does not exist
        insert into public.usage_monthly_exhibit (
          museum_id, month_key, exhibit_id, questions_total
        )
        values (
          p_museum_id, p_month_key, p_exhibit_id, 1
        )
        on conflict (museum_id, month_key, exhibit_id)
        do update set
          questions_total = public.usage_monthly_exhibit.questions_total + 1;
    end;

    insert into public.usage_daily_exhibit (
      museum_id, exhibition_id, exhibit_id, usage_date, questions_total
    )
    values (
      p_museum_id, v_exhibition_id, p_exhibit_id, current_date, 1
    )
    on conflict (museum_id, exhibition_id, exhibit_id, usage_date)
    do update set
      questions_total = public.usage_daily_exhibit.questions_total + 1,
      updated_at = now();
  end if;
end;
$$;

commit;

-- 5) quota_get_status RPC (precise from usage_daily_exhibit, supports monthly_anchor/custom)
create or replace function public.quota_get_status(
  p_museum_id text,
  p_now timestamptz default now()
)
returns table (
  museum_id text,
  quota_enabled boolean,
  is_active boolean,
  block_on_exhaustion boolean,
  period_type text,
  period_start_at timestamptz,
  period_end_at timestamptz,
  quota_limit_questions integer,
  used_questions integer,
  remaining_questions integer,
  percent_used numeric,
  should_warn boolean,
  should_block boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.usage_quota_policy%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_used integer := 0;

  v_anchor_day int;
  v_tz text;
  v_now_local date;
  v_current_month_anchor date;
begin
  select *
  into v_policy
  from public.usage_quota_policy
  where usage_quota_policy.museum_id = p_museum_id
  limit 1;

  if not found then
    return query
    select
      p_museum_id,
      false,
      false,
      false,
      'monthly_anchor'::text,
      null::timestamptz,
      null::timestamptz,
      0,
      0,
      0,
      0::numeric,
      false,
      false;
    return;
  end if;

  v_tz := coalesce(nullif(v_policy.anchor_timezone, ''), 'UTC');

  if v_policy.period_type::text = 'custom' then
    v_start := v_policy.period_start_at;
    v_end := v_policy.period_end_at;
  else
    -- Supported main mode: monthly_anchor. Legacy/other values fallback to anchor day 1.
    v_anchor_day := greatest(1, least(coalesce(v_policy.anchor_day_of_month, 1), 28));
    v_now_local := (p_now at time zone v_tz)::date;

    v_current_month_anchor :=
      (date_trunc('month', v_now_local)::date + make_interval(days => v_anchor_day - 1));

    if v_now_local >= v_current_month_anchor then
      v_start := (v_current_month_anchor::timestamp at time zone v_tz);
      v_end := ((v_current_month_anchor + interval '1 month')::timestamp at time zone v_tz);
    else
      v_start := ((v_current_month_anchor - interval '1 month')::timestamp at time zone v_tz);
      v_end := (v_current_month_anchor::timestamp at time zone v_tz);
    end if;
  end if;

  if v_start is not null and v_end is not null then
    select coalesce(sum(ude.questions_total), 0)::integer
    into v_used
    from public.usage_daily_exhibit ude
    where ude.museum_id = p_museum_id
      and ude.usage_date >= (v_start at time zone v_tz)::date
      and ude.usage_date <  (v_end   at time zone v_tz)::date;
  else
    v_used := 0;
  end if;

  return query
  select
    v_policy.museum_id,
    v_policy.quota_enabled,
    v_policy.is_active,
    v_policy.block_on_exhaustion,
    v_policy.period_type::text,
    v_start,
    v_end,
    v_policy.quota_limit_questions,
    v_used,
    greatest(v_policy.quota_limit_questions - v_used, 0),
    case
      when v_policy.quota_limit_questions <= 0 then 0::numeric
      else round((v_used::numeric / v_policy.quota_limit_questions::numeric) * 100, 2)
    end,
    (
      v_policy.is_active
      and v_policy.quota_enabled
      and v_policy.quota_limit_questions > 0
      and ((v_used::numeric / v_policy.quota_limit_questions::numeric) * 100) >= v_policy.warn_threshold_percent
    ),
    (
      v_policy.is_active
      and v_policy.quota_enabled
      and v_policy.block_on_exhaustion
      and v_policy.quota_limit_questions > 0
      and v_used >= v_policy.quota_limit_questions
    );
end;
$$;

