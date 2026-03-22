import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, EmbedContentRequest } from '@google/generative-ai';

const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

type EmbedContentRest = EmbedContentRequest & {
  output_dimensionality?: number;
};

/**
 * pgvector の次元と揃える。公式は 768 / 1536 / 3072 等を推奨。
 * 未設定時は 1536（既存スキーマ想定）。
 */
function embeddingOutputDimension(): number {
  const raw = process.env.GEMINI_EMBEDDING_OUTPUT_DIMENSION?.trim();
  if (!raw) {
    return 1536;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `[Gemini] GEMINI_EMBEDDING_OUTPUT_DIMENSION="${raw}" is invalid; using ${1536}`
    );
    return 1536;
  }
  return n;
}

let client: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  if (!client) {
    client = new GoogleGenerativeAI(key);
  }
  return client;
}

function throwGeminiError(operation: string, model: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[Gemini] ${operation} failed`, { model, err });
  throw new Error(
    `[Gemini] ${operation} に失敗しました (model=${model}): ${detail}。` +
      `モデル廃止・改名・権限エラーの可能性があります。GEMINI_CHAT_MODEL / GEMINI_EMBEDDING_MODEL を確認するか、GEMINI_API_KEY を確認してください。`,
    { cause: err instanceof Error ? err : undefined }
  );
}

/** 対話・問いかけ生成（既定: gemini-2.5-flash-lite） */
export async function generateWithFlash(prompt: string): Promise<string> {
  try {
    const gen = getGeminiClient();
    const model = gen.getGenerativeModel({ model: CHAT_MODEL });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return text.trim();
  } catch (err) {
    throwGeminiError('generateContent', CHAT_MODEL, err);
  }
}

// 埋め込みベクトル（pgvector 保存用）
export async function embedText(text: string): Promise<number[]> {
  const dim = embeddingOutputDimension();
  const content: Content = {
    role: 'user',
    parts: [{ text }],
  };
  const request: EmbedContentRest = {
    content,
    output_dimensionality: dim,
  };

  try {
    const gen = getGeminiClient();
    const model = gen.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(request);
    const values = result.embedding.values;
    if (!values?.length) {
      throw new Error('Gemini embedding returned empty values');
    }
    return Array.from(values);
  } catch (err) {
    throwGeminiError('embedContent', EMBEDDING_MODEL, err);
  }
}
