import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
  type ResultField,
} from '@aws-sdk/client-cloudwatch-logs';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

export type LambdaFunctionSummary = {
  functionName: string;
  configuredMemoryMb: number;
  invocations: number;
  errors: number;
  throttles: number;
  averageDurationMs: number;
  p95DurationMs: number;
  maxConcurrentExecutions: number;
  billedDurationMs: number;
  averageMaxMemoryUsedMb: number;
  maxMemoryUsedMb: number;
  averageMemoryUtilizationPct: number;
  maxMemoryUtilizationPct: number;
  estimatedCostUsd: number;
  logsInsightsError: string | null;
};

const LAMBDA_REQUEST_COST_PER_MILLION_USD = 0.2;
const LAMBDA_X86_DURATION_COST_PER_GB_SECOND_USD = 0.0000166667;
const LOGS_QUERY_POLL_MS = 1000;
const LOGS_QUERY_MAX_POLLS = 60;

const cloudWatchClient = new CloudWatchClient({});
const cloudWatchLogsClient = new CloudWatchLogsClient({});
const lambdaClient = new LambdaClient({});

function numberOrZero(value?: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricId(metricName: string): string {
  return metricName.toLowerCase();
}

function logGroupName(functionName: string): string {
  return `/aws/lambda/${functionName}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metricQueries(functionName: string): MetricDataQuery[] {
  const definitions: Array<{
    metricName: string;
    stat: string;
  }> = [
    { metricName: 'Invocations', stat: 'Sum' },
    { metricName: 'Errors', stat: 'Sum' },
    { metricName: 'Throttles', stat: 'Sum' },
    { metricName: 'Duration', stat: 'Average' },
    { metricName: 'Duration', stat: 'p95' },
    { metricName: 'ConcurrentExecutions', stat: 'Maximum' },
  ];

  return definitions.map((definition) => ({
    Id: `${metricId(definition.metricName)}${definition.stat.replace(/[^a-zA-Z0-9]/g, '')}`,
    MetricStat: {
      Metric: {
        Namespace: 'AWS/Lambda',
        MetricName: definition.metricName,
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
      },
      Period: 60 * 60,
      Stat: definition.stat,
    },
    ReturnData: true,
  }));
}

type MetricsSnapshot = {
  invocations: number;
  errors: number;
  throttles: number;
  averageDurationMs: number;
  p95DurationMs: number;
  maxConcurrentExecutions: number;
};

function sum(values?: number[]): number {
  return (values ?? []).reduce((acc, value) => acc + value, 0);
}

function max(values?: number[]): number {
  return Math.max(0, ...(values ?? []));
}

async function getLambdaMetricSnapshot(
  functionName: string,
  start: Date,
  end: Date
): Promise<MetricsSnapshot> {
  const response = await cloudWatchClient.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: metricQueries(functionName),
    })
  );

  const values = new Map<string, number[]>();
  for (const result of response.MetricDataResults ?? []) {
    values.set(result.Id ?? '', result.Values ?? []);
  }

  const invocationValues = values.get('invocationsSum') ?? [];
  const durationAverageValues = values.get('durationAverage') ?? [];

  const totalInvocations = sum(invocationValues);
  const weightedDurationTotal = durationAverageValues.reduce((acc, duration, index) => {
    const bucketInvocations = invocationValues[index] ?? 0;
    return acc + duration * bucketInvocations;
  }, 0);
  const averageDurationMs =
    totalInvocations > 0 ? weightedDurationTotal / totalInvocations : 0;

  return {
    invocations: totalInvocations,
    errors: sum(values.get('errorsSum')),
    throttles: sum(values.get('throttlesSum')),
    averageDurationMs,
    p95DurationMs: max(values.get('durationp95')),
    maxConcurrentExecutions: max(values.get('concurrentexecutionsMaximum')),
  };
}

type LogsInsightsSnapshot = {
  billedDurationMs: number;
  averageMaxMemoryUsedMb: number;
  maxMemoryUsedMb: number;
  memorySizeMb: number;
  error: string | null;
};

function fieldMap(fields: ResultField[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.field && field.value !== undefined)
      .map((field) => [field.field as string, field.value as string])
  );
}

async function getLogsInsightsSnapshot(
  functionName: string,
  start: Date,
  end: Date
): Promise<LogsInsightsSnapshot> {
  const startQuery = await cloudWatchLogsClient.send(
    new StartQueryCommand({
      logGroupName: logGroupName(functionName),
      startTime: Math.floor(start.getTime() / 1000),
      endTime: Math.floor(end.getTime() / 1000),
      queryString: [
        'filter @type = "REPORT"',
        '| stats',
        '    sum(@billedDuration) as billedDurationMs,',
        '    avg(@maxMemoryUsed / 1024 / 1024) as averageMaxMemoryUsedMb,',
        '    max(@maxMemoryUsed / 1024 / 1024) as maxMemoryUsedMb,',
        '    max(@memorySize / 1024 / 1024) as memorySizeMb',
      ].join('\n'),
    })
  );

  const queryId = startQuery.queryId;
  if (!queryId) {
    throw new Error(`CloudWatch Logs Insights queryId を取得できませんでした: ${functionName}`);
  }

  for (let i = 0; i < LOGS_QUERY_MAX_POLLS; i += 1) {
    await wait(LOGS_QUERY_POLL_MS);
    const result = await cloudWatchLogsClient.send(
      new GetQueryResultsCommand({ queryId })
    );

    if (result.status === 'Complete') {
      const row = result.results?.[0];
      const data = row ? fieldMap(row) : {};
      return {
        billedDurationMs: numberOrZero(data.billedDurationMs),
        averageMaxMemoryUsedMb: numberOrZero(data.averageMaxMemoryUsedMb),
        maxMemoryUsedMb: numberOrZero(data.maxMemoryUsedMb),
        memorySizeMb: numberOrZero(data.memorySizeMb),
        error: null,
      };
    }

    if (result.status === 'Failed' || result.status === 'Cancelled' || result.status === 'Timeout') {
      throw new Error(
        `CloudWatch Logs Insights query が失敗しました: ${functionName} status=${result.status}`
      );
    }
  }

  throw new Error(`CloudWatch Logs Insights query がタイムアウトしました: ${functionName}`);
}

async function getConfiguredMemoryMb(functionName: string): Promise<number> {
  const response = await lambdaClient.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    })
  );
  return response.MemorySize ?? 0;
}

function estimateLambdaCostUsd(params: {
  invocations: number;
  billedDurationMs: number;
  configuredMemoryMb: number;
}): number {
  const requestCost =
    (params.invocations / 1_000_000) * LAMBDA_REQUEST_COST_PER_MILLION_USD;
  const gbSeconds =
    (params.billedDurationMs / 1000) * (params.configuredMemoryMb / 1024);
  const durationCost = gbSeconds * LAMBDA_X86_DURATION_COST_PER_GB_SECOND_USD;
  return requestCost + durationCost;
}

function utilizationPct(usedMb: number, configuredMb: number): number {
  if (!configuredMb) {
    return 0;
  }
  return (usedMb / configuredMb) * 100;
}

export async function getLambdaFunctionSummary(params: {
  functionName: string;
  start: Date;
  end: Date;
}): Promise<LambdaFunctionSummary> {
  const [metrics, logs, configuredMemoryMb] = await Promise.all([
    getLambdaMetricSnapshot(params.functionName, params.start, params.end),
    getLogsInsightsSnapshot(params.functionName, params.start, params.end).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Logs Insights fallback for ${params.functionName}: ${detail}`);
      return {
        billedDurationMs: 0,
        averageMaxMemoryUsedMb: 0,
        maxMemoryUsedMb: 0,
        memorySizeMb: 0,
        error: detail,
      } satisfies LogsInsightsSnapshot;
    }),
    getConfiguredMemoryMb(params.functionName),
  ]);

  const effectiveMemoryMb = logs.memorySizeMb || configuredMemoryMb;

  return {
    functionName: params.functionName,
    configuredMemoryMb: effectiveMemoryMb,
    invocations: metrics.invocations,
    errors: metrics.errors,
    throttles: metrics.throttles,
    averageDurationMs: metrics.averageDurationMs,
    p95DurationMs: metrics.p95DurationMs,
    maxConcurrentExecutions: metrics.maxConcurrentExecutions,
    billedDurationMs: logs.billedDurationMs,
    averageMaxMemoryUsedMb: logs.averageMaxMemoryUsedMb,
    maxMemoryUsedMb: logs.maxMemoryUsedMb,
    averageMemoryUtilizationPct: utilizationPct(logs.averageMaxMemoryUsedMb, effectiveMemoryMb),
    maxMemoryUtilizationPct: utilizationPct(logs.maxMemoryUsedMb, effectiveMemoryMb),
    estimatedCostUsd: estimateLambdaCostUsd({
      invocations: metrics.invocations,
      billedDurationMs: logs.billedDurationMs,
      configuredMemoryMb: effectiveMemoryMb,
    }),
    logsInsightsError: logs.error,
  };
}
