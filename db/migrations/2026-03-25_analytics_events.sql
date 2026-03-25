-- Base analytics events table
-- Required by netlify/functions/analytics.js and analytics-report fallback.

begin;

create table if not exists public.analytics_events (
  analytics_event_id bigserial primary key,
  event_name text not null,
  museum_id text null,
  exhibition_id text null,
  exhibit_id text null,
  session_id text not null,
  page text null,
  source text not null default 'web',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events using btree (created_at);

create index if not exists analytics_events_museum_exhibition_created_idx
  on public.analytics_events using btree (museum_id, exhibition_id, created_at);

create index if not exists analytics_events_event_name_created_idx
  on public.analytics_events using btree (event_name, created_at);

create index if not exists analytics_events_session_id_idx
  on public.analytics_events using btree (session_id);

alter table public.analytics_events enable row level security;
revoke all privileges on public.analytics_events from anon, authenticated;

commit;
