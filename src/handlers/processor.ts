import type { Handler } from 'aws-lambda';
import { embedText, generateWithFlash } from '../lib/gemini';
import { notifyOpsError } from '../lib/opsAlert';
import { formatVectorForPg, getSupabaseClient } from '../lib/supabase';

/**
 * 要約（未設定時）と埋め込みベクトルを付与するバッチ。
 * EventBridge で 1 日 1 回（serverless.yml の cron）。1 回最大 10 件。Vertex AI の認証情報必須。
 */
export const handler: Handler = async () => {
  try {
    const db = getSupabaseClient();

    const { data: rows, error } = await db
      .from('daily_thought_logs')
      .select('id, content, summary')
      .is('embedding', null)
      .limit(10);

    if (error) {
      console.error(error);
      throw error;
    }

    if (!rows?.length) {
      return;
    }

    for (const row of rows as { id: string; content: unknown; summary: string | null }[]) {
      const text = JSON.stringify(row.content);
      const summary =
        row.summary ??
        (await generateWithFlash(`次の JSON を要約し、1文で日本語で返してください:\n${text}`));
      const vector = await embedText(summary);
      const embedding = formatVectorForPg(vector);

      const { error: upErr } = await db
        .from('daily_thought_logs')
        .update({ summary, embedding })
        .eq('id', row.id);

      if (upErr) {
        console.error(upErr);
        await notifyOpsError({
          functionName: 'processor',
          error: upErr,
          hint: `Supabase update に失敗しました。 id=${row.id}`,
        });
      }
    }
  } catch (e) {
    console.error(e);
    await notifyOpsError({ functionName: 'processor', error: e });
    throw e;
  }
};
