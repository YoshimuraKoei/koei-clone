import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * embedding 列は pgvector。次元は GEMINI_EMBEDDING_OUTPUT_DIMENSION（既定 1536）と一致させる。
 * gemini-embedding-2-preview は MRL で 768 / 1536 / 3072 等に切り替え可能。
 */

/** daily_thought_logs.content の想定形 */
export type ThoughtMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type DailyThoughtLogContent = {
  messages: ThoughtMessage[];
};

export type DailyThoughtLogRow = {
  id?: string;
  created_at?: string;
  topic?: string | null;
  content: DailyThoughtLogContent;
  embedding?: string | null;
  summary?: string | null;
  /** Slack Events API の event_id（一意・再送時の重複 insert 防止） */
  slack_event_id?: string | null;
};

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  if (!supabase) {
    supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

/** vector 列へ渡す文字列形式: '[0.1,0.2,...]' */
export function formatVectorForPg(values: number[]): string {
  return `[${values.join(',')}]`;
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '');
}

/**
 * @returns duplicate が true のときは同一 slack_event_id が既にあり、insert しなかった（Slack 再送など）
 */
export async function insertDailyThoughtLog(
  row: DailyThoughtLogRow
): Promise<{ duplicate: boolean }> {
  const db = getSupabaseClient();
  const { error } = await db.from('daily_thought_logs').insert({
    topic: row.topic ?? null,
    content: row.content,
    embedding: row.embedding ?? null,
    summary: row.summary ?? null,
    slack_event_id: row.slack_event_id ?? null,
  });
  if (error) {
    if (isUniqueViolation(error)) {
      return { duplicate: true };
    }
    throw error;
  }
  return { duplicate: false };
}
