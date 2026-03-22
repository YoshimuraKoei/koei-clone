import type { AwsCallback, AwsEvent, AwsResponse } from '@slack/bolt/dist/receivers/AwsLambdaReceiver';
import { createAwsLambdaReceiver, createSlackApp } from '../lib/slack';
import { insertDailyThoughtLog } from '../lib/supabase';

const awsLambdaReceiver = createAwsLambdaReceiver();
const app = createSlackApp(awsLambdaReceiver);

/**
 * Slack Events API: URL 検証は Bolt が処理。
 * ユーザーの発言をパースし、Supabase に保存する。`body.event_id` で再送時の二重登録を防ぐ。
 */
app.message(async ({ message, say, body }) => {
  if (message.subtype !== undefined) {
    return;
  }
  if ('bot_id' in message && message.bot_id) {
    return;
  }

  const text =
    'text' in message && typeof message.text === 'string' ? message.text.trim() : '';
  if (!text) {
    return;
  }

  /** スレッド内の発言は thread_ts（親）、チャンネル直下は ts を親として返信する */
  const replyThreadTs =
    'thread_ts' in message && message.thread_ts ? message.thread_ts : message.ts;

  const eventId = body.event_id;
  if (!eventId) {
    console.warn('Slack body.event_id missing; duplicate prevention disabled');
  }

  try {
    const { duplicate } = await insertDailyThoughtLog({
      topic: null,
      content: {
        messages: [{ role: 'user', content: text }],
      },
      slack_event_id: eventId ?? null,
    });
    if (duplicate) {
      console.log('duplicate Slack event_id, skip insert and reply', eventId);
      return;
    }
  } catch (e) {
    console.error(e);
    await say({ text: '保存に失敗しました。', thread_ts: replyThreadTs });
    return;
  }

  await say({
    text: '記録しました（スケルトン応答）',
    thread_ts: replyThreadTs,
  });
});

type BoltLambdaHandler = (event: AwsEvent, context: unknown, callback: AwsCallback) => Promise<AwsResponse>;

let boltHandler: BoltLambdaHandler | null = null;

export const handler = async (
  event: AwsEvent,
  context: unknown,
  callback: AwsCallback
): Promise<AwsResponse> => {
  if (!boltHandler) {
    boltHandler = await awsLambdaReceiver.start();
  }
  return boltHandler(event, context, callback);
};
