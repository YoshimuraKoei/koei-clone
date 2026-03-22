-- receiver の冪等化: 同一 Slack Events API の event_id は 1 行だけ
-- 001_create_daily_thought_logs.sql 実行済みのあと、Supabase SQL Editor で実行（実行順 2）

alter table public.daily_thought_logs
  add column if not exists slack_event_id text;

create unique index if not exists daily_thought_logs_slack_event_id_key
  on public.daily_thought_logs (slack_event_id);

comment on column public.daily_thought_logs.slack_event_id is
  'Slack event_callback の event_id（再送時の重複防止）';
