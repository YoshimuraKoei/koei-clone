import { getCloudPlatformScope, getGcpProjectId, getGoogleAccessToken, getVertexAiLocation } from './googleCloud';

const CHAT_MODEL = 'gemini-2.5-flash-lite';
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBEDDING_OUTPUT_DIMENSION = 1536;

function vertexServiceBaseUrl(location: string): string {
  return location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
}

function throwGeminiError(operation: string, model: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[Gemini] ${operation} failed`, { model, err });
  throw new Error(
    `[Gemini] ${operation} に失敗しました (model=${model}): ${detail}。` +
      `モデル廃止・改名・権限エラーの可能性があります。GCP_PROJECT_ID / GCP_SERVICE_ACCOUNT_JSON / VERTEX_AI_LOCATION を確認してください。`,
    { cause: err instanceof Error ? err : undefined }
  );
}

async function postVertexModel<T>(
  apiVersion: 'v1' | 'v1beta1',
  model: string,
  action: 'generateContent' | 'embedContent',
  body: Record<string, unknown>
): Promise<T> {
  const projectId = getGcpProjectId();
  const location = getVertexAiLocation();
  const accessToken = await getGoogleAccessToken([getCloudPlatformScope()]);
  const endpoint = `${vertexServiceBaseUrl(location)}/${apiVersion}/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`status=${response.status} body=${detail}`);
  }

  return (await response.json()) as T;
}

export async function generateWithFlash(prompt: string): Promise<string> {
  try {
    const result = await postVertexModel<{
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    }>('v1', CHAT_MODEL, 'generateContent', {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    });

    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!text) {
      throw new Error('Vertex AI generateContent returned empty text');
    }
    return text;
  } catch (err) {
    throwGeminiError('generateContent', CHAT_MODEL, err);
  }
}

export async function embedText(text: string): Promise<number[]> {
  try {
    const result = await postVertexModel<{
      embedding?: {
        values?: number[];
      };
    }>('v1beta1', EMBEDDING_MODEL, 'embedContent', {
      content: {
        role: 'user',
        parts: [{ text }],
      },
      outputDimensionality: EMBEDDING_OUTPUT_DIMENSION,
      taskType: 'RETRIEVAL_DOCUMENT',
    });

    const values = result.embedding?.values;

    if (!values?.length) {
      throw new Error('Vertex AI 埋め込みベクトルが空です');
    }
    return Array.from(values);
  } catch (err) {
    throwGeminiError('埋め込みベクトル生成', EMBEDDING_MODEL, err);
  }
}
