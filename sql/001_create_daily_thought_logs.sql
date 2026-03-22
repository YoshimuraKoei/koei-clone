-- 初回のみ: Supabase SQL Editor で実行（実行順 1）
-- その後 002_add_slack_event_id.sql を実行する

create extension if not exists vector;

create table public.daily_thought_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic text,
  content jsonb not null default '{"messages":[]}'::jsonb,
  embedding vector(1536),
  summary text
);

comment on column public.daily_thought_logs.content is
  '例: {"messages":[{"role":"user","content":"..."}]}';

comment on column public.daily_thought_logs.embedding is
  'GEMINI_EMBEDDING_OUTPUT_DIMENSION と次元を揃える（既定1536）';
