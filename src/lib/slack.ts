import { App, AwsLambdaReceiver } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

export function createAwsLambdaReceiver(): AwsLambdaReceiver {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error('SLACK_SIGNING_SECRET が未設定です');
  }
  return new AwsLambdaReceiver({
    signingSecret,
  });
}

export function createSlackApp(receiver: AwsLambdaReceiver): App {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!token || !signingSecret) {
    throw new Error('SLACK_BOT_TOKEN または SLACK_SIGNING_SECRET が未設定です');
  }
  return new App({
    token,
    signingSecret,
    receiver,
  });
}

export async function postSlackMessage(params: { channel: string; text: string }): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN が未設定です');
  }

  const client = new WebClient(token);
  await client.chat.postMessage({
    channel: params.channel,
    text: params.text,
  });
}
