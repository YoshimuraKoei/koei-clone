import type { Handler } from 'aws-lambda';
import { getLambdaFunctionSummary, type LambdaFunctionSummary } from '../lib/awsMonitoring';
import { notifyOpsError } from '../lib/opsAlert';
import { recentDaysWindowJst } from '../lib/reportingWindow';
import { postSlackMessage } from '../lib/slack';

const LOOKBACK_DAYS = 7;
const MONITORED_FUNCTION_SUFFIXES = [
  'receiver',
  'scheduler',
  'processor',
  'vertexAiOpsReporter',
  'lambdaOpsReporter',
] as const;

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('ja-JP', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function deploymentPrefix(): string {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME?.trim();
  if (!functionName) {
    throw new Error('AWS_LAMBDA_FUNCTION_NAME が未設定です。');
  }
  const suffix = '-lambdaOpsReporter';
  if (!functionName.endsWith(suffix)) {
    throw new Error(`lambdaOpsReporter の関数名形式を解釈できません: ${functionName}`);
  }
  return functionName.slice(0, -suffix.length);
}

function functionNamesToMonitor(): string[] {
  const prefix = deploymentPrefix();
  return MONITORED_FUNCTION_SUFFIXES.map((suffix) => `${prefix}-${suffix}`);
}

function displayFunctionName(functionName: string): string {
  return functionName.split('-').pop() ?? functionName;
}

function formatMemory(summary: LambdaFunctionSummary): string {
  if (summary.maxMemoryUsedMb <= 0) {
    return summary.logsInsightsError ? 'unavailable' : '-';
  }

  return [
    `avg ${formatNumber(summary.averageMaxMemoryUsedMb, 1)}MB`,
    `max ${formatNumber(summary.maxMemoryUsedMb, 1)}MB`,
    `peak ${formatNumber(summary.maxMemoryUtilizationPct, 1)}%`,
  ].join(' / ');
}

function compactError(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function buildSummaryLines(params: {
  label: string;
  summaries: LambdaFunctionSummary[];
}): string[] {
  const totalEstimatedCost = params.summaries.reduce((acc, item) => acc + item.estimatedCostUsd, 0);

  const lines = [
    `:bar_chart: *Lambda 利用サマリ*`,
    `対象期間: ${params.label}`,
    `推定費用: ${formatUsd(totalEstimatedCost)} (free tier / region差分を除く概算)`,
  ];

  if (!params.summaries.length) {
    lines.push('該当データは見つかりませんでした。');
    return lines;
  }

  for (const summary of params.summaries) {
    lines.push(`• \`${displayFunctionName(summary.functionName)}\``);
    lines.push(
      [
        `  calls ${formatNumber(summary.invocations)}`,
        `err ${formatNumber(summary.errors)}`,
        `throttle ${formatNumber(summary.throttles)}`,
        `conc ${formatNumber(summary.maxConcurrentExecutions, 1)}`,
      ].join(' | ')
    );
    lines.push(
      [
        `  dur avg ${formatNumber(summary.averageDurationMs, 1)}ms`,
        `p95 ${formatNumber(summary.p95DurationMs, 1)}ms`,
        `mem ${formatMemory(summary)}`,
        `cost ${formatUsd(summary.estimatedCostUsd)}`,
      ].join(' | ')
    );
    if (summary.logsInsightsError) {
      lines.push(`  logs ${compactError(summary.logsInsightsError)}`);
    }
  }

  return lines;
}

export const handler: Handler = async () => {
  try {
    const channelId = process.env.SLACK_OPS_CHANNEL_ID?.trim();
    if (!channelId) {
      throw new Error('lambdaOpsReporter: SLACK_OPS_CHANNEL_ID が未設定です。');
    }

    const window = recentDaysWindowJst(new Date(), LOOKBACK_DAYS);
    const summaries = await Promise.all(
      functionNamesToMonitor().map((functionName) =>
        getLambdaFunctionSummary({
          functionName,
          start: window.start,
          end: window.end,
        })
      )
    );

    const lines = buildSummaryLines({
      label: window.label,
      summaries: summaries.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    });

    await postSlackMessage({
      channel: channelId,
      text: lines.join('\n'),
    });
  } catch (error) {
    console.error(error);
    await notifyOpsError({
      functionName: 'lambdaOpsReporter',
      error,
    });
    throw error;
  }
};
