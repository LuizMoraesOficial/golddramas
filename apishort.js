import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvFile();

const DEFAULT_BASE_URL = 'https://apishort.com';
const ALLOWED_ENDPOINTS = new Set(['popular', 'new', 'hot', 'category', 'search', 'detail', 'alleps', 'languages']);

function getApiShortConfig() {
  return {
    baseUrl: (process.env.APISHORT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    provider: (process.env.APISHORT_PROVIDER || 'shortmax').toLowerCase(),
    apiKey: process.env.APISHORT_API_KEY || '',
  };
}

function endpointPath(endpoint) {
  const { provider } = getApiShortConfig();
  if (endpoint === 'popular' || endpoint === 'new' || endpoint === 'hot' || endpoint === 'search' || endpoint === 'languages') {
    return `/v1/${provider}/api/v1/${endpoint}`;
  }
  const match = endpoint.match(/^(category|detail|alleps)\/([A-Za-z0-9_-]+)$/);
  if (match) return `/v1/${provider}/api/v1/${match[1]}/${encodeURIComponent(match[2])}`;
  throw new ApiShortError(404, 'Rota da APIShort não habilitada neste proxy.');
}

export class ApiShortError extends Error {
  constructor(status, message, code = 'APISHORT_ERROR') {
    super(message);
    this.name = 'ApiShortError';
    this.status = status;
    this.code = code;
  }
}

export async function requestApiShort(endpoint, searchParams = {}) {
  if (!ALLOWED_ENDPOINTS.has(endpoint.split('/')[0])) {
    throw new ApiShortError(404, 'Endpoint não permitido.');
  }
  const { baseUrl, apiKey } = getApiShortConfig();
  if (!apiKey) {
    throw new ApiShortError(503, 'Catálogo temporariamente indisponível. Verifique a configuração do servidor.', 'APISHORT_KEY_MISSING');
  }

  const url = new URL(endpointPath(endpoint), baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string' && value.trim()) url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiShortError(502, 'A APIShort retornou uma resposta que não é JSON válido.', 'APISHORT_INVALID_JSON');
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `APIShort respondeu HTTP ${response.status}.`;
      throw new ApiShortError(response.status, String(message).slice(0, 300), 'APISHORT_UPSTREAM_ERROR');
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiShortError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiShortError(504, 'A APIShort não respondeu dentro de 12 segundos.', 'APISHORT_TIMEOUT');
    }
    throw new ApiShortError(502, 'Não foi possível conectar à APIShort.', 'APISHORT_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}
