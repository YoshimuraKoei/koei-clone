import { getCloudPlatformScope, getGcpProjectId, getGoogleAccessToken, getVertexAiLocation } from './googleCloud';

type TimeSeriesPointValue = {
  int64Value?: string;
  doubleValue?: number;
};

type TimeSeriesPoint = {
  value?: TimeSeriesPointValue;
};

type TimeSeries = {
  metric?: {
    labels?: Record<string, string>;
  };
  resource?: {
    labels?: Record<string, string>;
  };
  points?: TimeSeriesPoint[];
};

type TimeSeriesListResponse = {
  nextPageToken?: string;
  timeSeries?: TimeSeries[];
};

type TimeSeriesQuery = {
  metricType: string;
  resourceType: string;
  extraFilters?: string[];
};

export type ModelUsageSummary = {
  model: string;
  kind: 'generateContent' | 'onlinePrediction';
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  quotaExceededCount: number;
};

function monitoringApiBaseUrl(projectId: string): string {
  return `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`;
}

function onlinePredictionQuotaExceededMetricName(): string {
  const location = getVertexAiLocation();
  const prefix =
    location === 'global'
      ? 'aiplatform.googleapis.com/quota/global_online_prediction'
      : 'aiplatform.googleapis.com/quota/online_prediction';
  return `${prefix}_requests_per_base_model/exceeded`;
}

function generateContentQuotaExceededMetricName(): string {
  return 'aiplatform.googleapis.com/quota/generate_content_requests_per_minute_per_project_per_base_model/exceeded';
}

const PUBLISHER_MODEL_INVOCATION_COUNT_METRIC =
  'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count';
const PUBLISHER_MODEL_TOKEN_COUNT_METRIC =
  'aiplatform.googleapis.com/publisher/online_serving/token_count';

function numberFromPointValue(value?: TimeSeriesPointValue): number {
  if (!value) {
    return 0;
  }
  if (typeof value.doubleValue === 'number') {
    return value.doubleValue;
  }
  if (typeof value.int64Value === 'string') {
    const parsed = Number.parseInt(value.int64Value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function listTimeSeries(
  accessToken: string,
  projectId: string,
  metricType: string,
  resourceType: string,
  startIso: string,
  endIso: string,
  extraFilters: string[] = []
): Promise<TimeSeries[]> {
  const filter = [
    `metric.type="${metricType}"`,
    `resource.type="${resourceType}"`,
    ...extraFilters,
  ].join(' AND ');

  const results: TimeSeries[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(monitoringApiBaseUrl(projectId));
    url.searchParams.set('filter', filter);
    url.searchParams.set('interval.startTime', startIso);
    url.searchParams.set('interval.endTime', endIso);
    url.searchParams.set('view', 'FULL');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Cloud Monitoring timeSeries.list に失敗しました (metric=${metricType}, status=${response.status}): ${body}`
      );
    }

    const payload = (await response.json()) as TimeSeriesListResponse;
    results.push(...(payload.timeSeries ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return results;
}

async function runTimeSeriesQueries(
  queries: TimeSeriesQuery[],
  startIso: string,
  endIso: string
): Promise<TimeSeries[][]> {
  const accessToken = await getGoogleAccessToken([getCloudPlatformScope()]);
  const projectId = getGcpProjectId();

  return Promise.all(
    queries.map((query) =>
      listTimeSeries(
        accessToken,
        projectId,
        query.metricType,
        query.resourceType,
        startIso,
        endIso,
        query.extraFilters ?? []
      )
    )
  );
}

function modelKey(item: TimeSeries): string | null {
  const labels = item.metric?.labels ?? {};
  const resourceLabels = item.resource?.labels ?? {};
  const candidates = [
    labels.base_model,
    labels.model,
    labels.publisher_model,
    resourceLabels.model_user_id,
    resourceLabels.model_version_id,
    resourceLabels.publisher_model,
    resourceLabels.model,
    resourceLabels.base_model,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function aggregateByModel(series: TimeSeries[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const item of series) {
    const model = modelKey(item);
    if (!model) {
      continue;
    }

    const sum = (item.points ?? []).reduce((acc, point) => {
      return acc + numberFromPointValue(point.value);
    }, 0);
    totals.set(model, (totals.get(model) ?? 0) + sum);
  }

  return totals;
}

function inferKind(model: string): 'generateContent' | 'onlinePrediction' {
  return model.toLowerCase().includes('embedding') ? 'onlinePrediction' : 'generateContent';
}

export async function getVertexAiUsageSummary(
  start: Date,
  end: Date
): Promise<ModelUsageSummary[]> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const queries: TimeSeriesQuery[] = [
    {
      metricType: PUBLISHER_MODEL_INVOCATION_COUNT_METRIC,
      resourceType: 'aiplatform.googleapis.com/PublisherModel',
    },
    {
      metricType: PUBLISHER_MODEL_TOKEN_COUNT_METRIC,
      resourceType: 'aiplatform.googleapis.com/PublisherModel',
      extraFilters: ['metric.labels.type="input"'],
    },
    {
      metricType: PUBLISHER_MODEL_TOKEN_COUNT_METRIC,
      resourceType: 'aiplatform.googleapis.com/PublisherModel',
      extraFilters: ['metric.labels.type="output"'],
    },
    {
      metricType: onlinePredictionQuotaExceededMetricName(),
      resourceType: 'aiplatform.googleapis.com/Location',
    },
    {
      metricType: generateContentQuotaExceededMetricName(),
      resourceType: 'aiplatform.googleapis.com/Location',
    },
  ];

  const [
    requestSeries,
    inputTokenSeries,
    outputTokenSeries,
    onlineQuotaExceededSeries,
    generateQuotaExceededSeries,
  ] = await runTimeSeriesQueries(queries, startIso, endIso);

  const requestTotals = aggregateByModel(requestSeries);
  const inputTokenTotals = aggregateByModel(inputTokenSeries);
  const outputTokenTotals = aggregateByModel(outputTokenSeries);
  const onlineQuotaExceededTotals = aggregateByModel(onlineQuotaExceededSeries);
  const generateQuotaExceededTotals = aggregateByModel(generateQuotaExceededSeries);

  const models = new Set([
    ...requestTotals.keys(),
    ...inputTokenTotals.keys(),
    ...outputTokenTotals.keys(),
    ...onlineQuotaExceededTotals.keys(),
    ...generateQuotaExceededTotals.keys(),
  ]);

  return Array.from(models)
    .map((model) => {
      const kind = inferKind(model);
      const quotaExceededCount =
        kind === 'onlinePrediction'
          ? onlineQuotaExceededTotals.get(model) ?? 0
          : generateQuotaExceededTotals.get(model) ?? 0;

      return {
        model,
        kind,
        requestCount: requestTotals.get(model) ?? 0,
        inputTokens: inputTokenTotals.get(model) ?? 0,
        outputTokens: outputTokenTotals.get(model) ?? 0,
        quotaExceededCount,
      };
    })
    .sort((a, b) => b.requestCount - a.requestCount || b.inputTokens - a.inputTokens);
}
