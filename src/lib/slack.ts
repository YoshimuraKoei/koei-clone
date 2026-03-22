import { App, AwsLambdaReceiver } from '@slack/bolt';

export function createAwsLambdaReceiver(): AwsLambdaReceiver {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error('SLACK_SIGNING_SECRET is not set');
  }
  return new AwsLambdaReceiver({
    signingSecret,
  });
}

export function createSlackApp(receiver: AwsLambdaReceiver): App {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!token || !signingSecret) {
    throw new Error('SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET is not set');
  }
  return new App({
    token,
    signingSecret,
    receiver,
  });
}
