import { GoogleAuth, type JWTInput } from 'google-auth-library';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

let parsedCredentials: JWTInput | null | undefined;

function parseServiceAccountJson(): JWTInput | null {
  if (parsedCredentials !== undefined) {
    return parsedCredentials;
  }

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    parsedCredentials = null;
    return parsedCredentials;
  }

  try {
    parsedCredentials = JSON.parse(raw) as JWTInput;
    return parsedCredentials;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`GCP_SERVICE_ACCOUNT_JSON の JSON 解析に失敗しました: ${detail}`);
  }
}

export function getGcpProjectId(): string {
  const envProjectId = process.env.GCP_PROJECT_ID?.trim();
  if (envProjectId) {
    return envProjectId;
  }

  const credentials = parseServiceAccountJson();
  if (credentials?.project_id) {
    return credentials.project_id;
  }

  throw new Error('GCP_PROJECT_ID が未設定です。GCP_SERVICE_ACCOUNT_JSON に project_id を含めることもできます。');
}

export function getVertexAiLocation(): string {
  return process.env.VERTEX_AI_LOCATION?.trim() || 'us-central1';
}

export function getCloudPlatformScope(): string {
  return CLOUD_PLATFORM_SCOPE;
}

export async function getGoogleAccessToken(
  scopes: string[] = [CLOUD_PLATFORM_SCOPE]
): Promise<string> {
  const auth = new GoogleAuth({
    projectId: getGcpProjectId(),
    scopes,
    credentials: parseServiceAccountJson() ?? undefined,
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === 'string' ? accessToken : accessToken.token;
  if (!token) {
    throw new Error('Google Cloud のアクセストークン取得に失敗しました。');
  }
  return token;
}
