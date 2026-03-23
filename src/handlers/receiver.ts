import type { AwsCallback, AwsEvent, AwsResponse } from '@slack/bolt/dist/receivers/AwsLambdaReceiver';
import { notifyOpsError } from '../lib/opsAlert';
import { createAwsLambdaReceiver, createSlackApp } from '../lib/slack';
import { insertDailyThoughtLog } from '../lib/supabase';

const awsLambdaReceiver = createAwsLambdaReceiver();
const app = createSlackApp(awsLambdaReceiver);

/**
 * Slack Events API: URL 検証は Bolt が処理。
 * ユーザーの発言をパースし、Supabase に保存する。`body.event_id` で再送時の二重登録を防ぐ。
 */
const allowedChannels = (process.env.SLACK_ALLOWED_CHANNEL_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.message(async ({ message, say, body }) => {
  if (message.subtype !== undefined) {
    return;
  }
  if ('bot_id' in message && message.bot_id) {
    return;
  }

  if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel)) {
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
    console.error('receiver: Slack body.event_id が未設定です。二重登録防止が無効です。');
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
      console.log('receiver: 同一 Slack event_id が存在するため、保存をスキップします。', eventId);
      return;
    }
  } catch (e) {
    console.error(e);
    await notifyOpsError({ functionName: 'receiver', error: e, hint: 'Supabase insert 失敗' });
    try {
      await say({ text: '保存に失敗しました。', thread_ts: replyThreadTs });
    } catch (sayErr) {
      console.error(sayErr);
      await notifyOpsError({ functionName: 'receiver', error: sayErr, hint: 'Slack への返信に失敗しました。（insert エラー後）' });
    }
    return;
  }

  try {
    await say({
      text: '記録しといた。',
      thread_ts: replyThreadTs,
    });
  } catch (e) {
    console.error(e);
    await notifyOpsError({ functionName: 'receiver', error: e, hint: 'Slack への返信に失敗しました。（記録成功後）' });
  }
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
  try {
    return await boltHandler(event, context, callback);
  } catch (e) {
    console.error(e);
    await notifyOpsError({ functionName: 'receiver', error: e });
    throw e;
  }
};
