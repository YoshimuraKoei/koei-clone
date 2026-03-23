import { WebClient } from '@slack/web-api';

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack ?? ''}`;
  }

  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  
  return String(err);
}

/**
 * 運用用 Slack チャンネルへエラー内容を投稿する。
 * `SLACK_OPS_CHANNEL_ID` が未設定のときは通知しないが、CloudWatch には error で残す。
 * 通知投稿の失敗は握りつぶし、コンソールに error を出す。
 */
export async function notifyOpsError(params: {
  functionName: string;
  error: unknown;
  hint?: string;
}): Promise<void> {
  const channel = process.env.SLACK_OPS_CHANNEL_ID?.trim();
  const token = process.env.SLACK_BOT_TOKEN;

  if (!channel) {
    console.error('notifyOpsError: SLACK_OPS_CHANNEL_ID が未設定です。');
    return;
  }
  if (!token) {
    console.error('notifyOpsError: SLACK_BOT_TOKEN が未設定です。');
    return;
  }

  const body = formatError(params.error);
  const text = [
    `:red_circle: *Lambda エラー* \`${params.functionName}\``,
    params.hint ? `_${params.hint}_` : '',
    '```',
    body.slice(0, 3500),
    '```',
  ].join('\n');

  try {
    const client = new WebClient(token);
    await client.chat.postMessage({ channel, text });
  } catch (e) {
    console.error('notifyOpsError: 通知投稿に失敗しました。', e);
  }
}
