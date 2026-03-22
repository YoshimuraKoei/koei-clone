import type { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { generateWithFlash } from '../lib/gemini';
import { notifyOpsError } from '../lib/opsAlert';

/**
 * EventBridge スケジュール: 毎日の問いかけを Slack チャンネルへ投稿。
 */
export const handler: Handler = async () => {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_DAILY_CHANNEL_ID;

    if (!token || !channelId) {
      console.error('scheduler: SLACK_BOT_TOKEN または SLACK_DAILY_CHANNEL_ID が未設定です。');
      return;
    }

    const client = new WebClient(token);
    const prompt =
      'あなたはユーザーの内省を促すコーチです。今日の問いを1つだけ、日本語で短く（1〜2文）返してください。フォーマットは「今日の問い：<問い>」です。';
    const question = await generateWithFlash(prompt);

    await client.chat.postMessage({
      channel: channelId,
      text: question,
    });
  } catch (e) {
    console.error(e);
    await notifyOpsError({ functionName: 'scheduler', error: e });
    throw e;
  }
};
