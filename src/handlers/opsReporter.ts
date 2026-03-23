import type { Handler } from 'aws-lambda';
import { getVertexAiUsageSummary, type ModelUsageSummary } from '../lib/googleMonitoring';
import { notifyOpsError } from '../lib/opsAlert';
import { postSlackMessage } from '../lib/slack';

const LOOKBACK_DAYS = 7;
const INPUT_COST_PER_MILLION_TOKENS = {
  generateContent: 0.1,
  onlinePrediction: 0.2,
} as const;
const OUTPUT_COST_PER_MILLION_TOKENS = {
  generateContent: 0.4,
  onlinePrediction: 0,
} as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function recentWeekWindowJst(now: Date): { start: Date; end: Date; label: string } {
  const dateLabel = (date: Date): string => {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  const end = now;
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    label: `${dateLabel(start)} - ${dateLabel(end)} の直近 ${LOOKBACK_DAYS} 日`,
  };
}

function estimateUsd(params: {
  kind: 'generateContent' | 'onlinePrediction';
  inputTokens: number;
  outputTokens: number;
}): number {
  const inputCost =
    (params.inputTokens / 1_000_000) * INPUT_COST_PER_MILLION_TOKENS[params.kind];
  const outputCost =
    (params.outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION_TOKENS[params.kind];
  return inputCost + outputCost;
}

function usageLabel(kind: ModelUsageSummary['kind']): string {
  return kind === 'generateContent' ? 'generate' : 'embed';
}

function buildSummaryLines(params: {
  label: string;
  usage: ModelUsageSummary[];
}): string[] {
  const totalEstimatedUsd = params.usage.reduce((acc, item) => {
    return acc + estimateUsd(item);
  }, 0);

  const lines = [
    `:bar_chart: *Vertex AI 利用サマリ*`,
    `対象期間: ${params.label}`,
    `推定費用: ${formatUsd(totalEstimatedUsd)}`,
  ];

  if (!params.usage.length) {
    lines.push('該当メトリクスは見つかりませんでした。まだ呼び出し実績がないか、Cloud Monitoring 反映待ちの可能性があります。');
    return lines;
  }

  for (const item of params.usage) {
    const estimatedUsd = estimateUsd(item);
    lines.push(
      [
        `• [${usageLabel(item.kind)}] \`${item.model}\``,
        `requests=${formatNumber(item.requestCount)}`,
        `input_tokens=${formatNumber(item.inputTokens)}`,
        `output_tokens=${formatNumber(item.outputTokens)}`,
        `quota_exceeded=${formatNumber(item.quotaExceededCount)}`,
        `estimated_cost=${formatUsd(estimatedUsd)}`,
      ].join(' ')
    );
  }

  return lines;
}

export const handler: Handler = async () => {
  try {
    const channelId = process.env.SLACK_OPS_CHANNEL_ID?.trim();

    if (!channelId) {
      throw new Error('opsReporter: SLACK_OPS_CHANNEL_ID が未設定です。');
    }

    const window = recentWeekWindowJst(new Date());
    const usage = await getVertexAiUsageSummary(window.start, window.end);
    const lines = buildSummaryLines({ label: window.label, usage });

    await postSlackMessage({
      channel: channelId,
      text: lines.join('\n'),
    });
    
  } catch (error) {
    console.error(error);
    await notifyOpsError({
      functionName: 'opsReporter',
      error,
    });
    throw error;
  }
};
