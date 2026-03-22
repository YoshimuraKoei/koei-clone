import type { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { generateWithFlash } from '../lib/gemini';

/**
 * EventBridge スケジュール: 毎日の問いかけを Slack へ投稿（DM またはチャンネル）。
 */
export const handler: Handler = async () => {
  const token = process.env.SLACK_BOT_TOKEN;
  const targetId = process.env.DAILY_PROMPT_TARGET_ID;
  if (!token || !targetId) {
    console.warn('SLACK_BOT_TOKEN または DAILY_PROMPT_TARGET_ID が未設定です。');
    return;
  }

  const client = new WebClient(token);
  const prompt =
    'あなたはユーザーの内省を促すコーチです。今日の問いを1つだけ、日本語で短く（1〜2文）返してください。';
  const question = await generateWithFlash(prompt);

  await client.chat.postMessage({
    channel: targetId,
    text: question,
  });
};
