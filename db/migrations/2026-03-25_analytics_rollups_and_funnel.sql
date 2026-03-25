-- Analytics daily aggregate tables + rollup function
-- Align production with staging so analytics-report can use aggregate sources.

begin;

create table if not exists public.analytics_daily_funnel (
  day date not null,
  museum_id text not null,
  exhibition_id text not null,
  app_open_sessions integer not null default 0,
  exhibit_view_sessions integer not null default 0,
  quick_question_clicks integer not null default 0,
  free_question_submits integer not null default 0,
  chat_answers integer not null default 0,
  video_play_clicks integer not null default 0,
  audio_play_clicks integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_daily_funnel_pkey primary key (day, museum_id, exhibition_id)
);

create index if not exists analytics_daily_funnel_day_idx
  on public.analytics_daily_funnel using btree (day);

create table if not exists public.analytics_daily_rollup (
  day date not null,
  museum_id text not null,
  exhibition_id text not null,
  exhibit_id text not null,
  event_name text not null,
  events_count integer not null default 0,
  unique_sessions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_daily_rollup_pkey primary key (
    day,
    museum_id,
    exhibition_id,
    exhibit_id,
    event_name
  )
);

create index if not exists analytics_daily_rollup_day_idx
  on public.analytics_daily_rollup using btree (day);

create or replace function public.analytics_rollup_for_day(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Per-event rollup by day / museum / exhibition / exhibit.
  insert into public.analytics_daily_rollup (
    day, museum_id, exhibition_id, exhibit_id, event_name, events_count, unique_sessions, updated_at
  )
  select
    p_day as day,
    e.museum_id,
    e.exhibition_id,
    e.exhibit_id,
    e.event_name,
    count(*)::int as events_count,
    count(distinct e.session_id)::int as unique_sessions,
    now()
  from public.analytics_events e
  where (e.created_at at time zone 'UTC')::date = p_day
  group by e.museum_id, e.exhibition_id, e.exhibit_id, e.event_name
  on conflict (day, museum_id, exhibition_id, exhibit_id, event_name)
  do update set
    events_count = excluded.events_count,
    unique_sessions = excluded.unique_sessions,
    updated_at = now();

  -- Daily funnel by museum / exhibition.
  insert into public.analytics_daily_funnel (
    day, museum_id, exhibition_id,
    app_open_sessions,
    exhibit_view_sessions,
    quick_question_clicks,
    free_question_submits,
    chat_answers,
    video_play_clicks,
    audio_play_clicks,
    updated_at
  )
  select
    p_day as day,
    e.museum_id,
    e.exhibition_id,
    count(distinct case when e.event_name = 'app_open' then e.session_id end)::int,
    count(distinct case when e.event_name = 'exhibit_view' then e.session_id end)::int,
    count(case when e.event_name = 'quick_question_click' then 1 end)::int,
    count(case when e.event_name = 'free_question_submit' then 1 end)::int,
    count(case when e.event_name = 'chat_answer_received' then 1 end)::int,
    count(case when e.event_name = 'video_play_click' then 1 end)::int,
    count(case when e.event_name = 'audio_play_click' then 1 end)::int,
    now()
  from public.analytics_events e
  where (e.created_at at time zone 'UTC')::date = p_day
  group by e.museum_id, e.exhibition_id
  on conflict (day, museum_id, exhibition_id)
  do update set
    app_open_sessions = excluded.app_open_sessions,
    exhibit_view_sessions = excluded.exhibit_view_sessions,
    quick_question_clicks = excluded.quick_question_clicks,
    free_question_submits = excluded.free_question_submits,
    chat_answers = excluded.chat_answers,
    video_play_clicks = excluded.video_play_clicks,
    audio_play_clicks = excluded.audio_play_clicks,
    updated_at = now();
end;
$function$;

alter table public.analytics_daily_funnel enable row level security;
alter table public.analytics_daily_rollup enable row level security;

revoke all privileges on public.analytics_daily_funnel from anon, authenticated;
revoke all privileges on public.analytics_daily_rollup from anon, authenticated;
revoke all privileges on function public.analytics_rollup_for_day(date) from anon, authenticated;

commit;
