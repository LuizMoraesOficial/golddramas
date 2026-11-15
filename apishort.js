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
const CACHE_DIR = path.join(root, '.cache');

/**
 * Allowlist de rotas e de parâmetros.
 *
 * Comportamento verificado contra a API real (nov/2026):
 * - `new` aceita `page`: as páginas 3, 4 e 7 acrescentam títulos em relação
 *   aos blocos já observados; 5, 6 e 8–15 repetiram títulos no teste de 15/nov.
 *   A partir de page=16 houve HTTP 500 no teste realizado.
 * - `popular`, `hot` e `category/{n}` ignoram `page` e `pageSize` e devolvem
 *   sempre a mesma lista; `category/{n}` ignora o próprio n (1, 2 e 999 são
 *   idênticos), portanto não servem para paginar.
 * - `search` aceita `q` (obrigatório) e devolve até ~26 itens; `page` e
 *   `pageSize` são ignorados. Com `lang=pt` os itens dublados em português
 *   chegam com o prefixo `[Dublado]` no campo `name`.
 */
const ENDPOINTS = {
  popular: { params: ['lang', 'page'], ttl: 12 * 60 * 60 * 1000 },
  new: { params: ['lang', 'page'], ttl: 12 * 60 * 60 * 1000 },
  hot: { params: ['lang', 'page'], ttl: 12 * 60 * 60 * 1000 },
  category: { params: ['lang', 'page', 'pageSize'], ttl: 12 * 60 * 60 * 1000 },
  search: { params: ['lang', 'q', 'page', 'pageSize'], ttl: 24 * 60 * 60 * 1000 },
  detail: { params: ['lang'], ttl: 6 * 60 * 60 * 1000 },
  // Os links HLS assinados valem 8 horas (expires_in 28800), então guardar por
  // 4 horas corta a reabertura repetida sem entregar URL vencida.
  alleps: { params: ['lang'], ttl: 4 * 60 * 60 * 1000 },
  languages: { params: [], ttl: 7 * 24 * 60 * 60 * 1000 },
};

function getApiShortConfig() {
  return {
    baseUrl: (process.env.APISHORT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    provider: (process.env.APISHORT_PROVIDER || 'shortmax').toLowerCase(),
    apiKey: process.env.APISHORT_API_KEY || '',
  };
}

export class ApiShortError extends Error {
  constructor(status, message, code = 'APISHORT_ERROR') {
    super(message);
    this.name = 'ApiShortError';
    this.status = status;
    this.code = code;
  }
}

function resolveEndpoint(endpoint) {
  const head = endpoint.split('/')[0];
  const config = ENDPOINTS[head];
  if (!config) throw new ApiShortError(404, 'Rota da APIShort não habilitada neste proxy.');
  return { head, config };
}

export function isCatalogEndpoint(endpoint) {
  const head = endpoint.split('/')[0];
  return head === 'popular' || head === 'new' || head === 'hot' || head === 'category' || head === 'search';
}

function endpointPath(provider, endpoint) {
  if (ENDPOINTS[endpoint] && !endpoint.includes('/')) return `/v1/${provider}/api/v1/${endpoint}`;
  const match = endpoint.match(/^(category|detail|alleps)\/([A-Za-z0-9_-]+)$/);
  if (match) return `/v1/${provider}/api/v1/${match[1]}/${encodeURIComponent(match[2])}`;
  throw new ApiShortError(404, 'Rota da APIShort não habilitada neste proxy.');
}

function pickParams(allowed, searchParams = {}) {
  const picked = {};
  for (const key of allowed) {
    const value = searchParams[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      picked[key] = String(Math.max(1, Math.floor(value)));
    } else if (typeof value === 'string' && value.trim()) {
      picked[key] = value.trim().slice(0, 120);
    }
  }
  return picked;
}

const memory = new Map();
const inFlight = new Map();

// Contador de chamadas que realmente saíram para a APIShort desde que esta
// instância subiu. O plano gratuito é de 100/dia, então /api/catalog/meta
// expõe o número para o dono acompanhar o consumo sem adivinhação.
const usage = { upstream: 0, cacheHits: 0, errors: {}, startedAt: Date.now() };

function cacheKey(endpoint, params) {
  return `${endpoint}?${new URLSearchParams(params).toString()}`;
}

function readDiskCache(key) {
  try {
    const file = path.join(CACHE_DIR, `${Buffer.from(key).toString('base64url')}.json`);
    if (!fs.existsSync(file)) return null;
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!envelope || typeof envelope.expiresAt !== 'number' || envelope.expiresAt < Date.now()) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

function writeDiskCache(key, data, ttl) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${Buffer.from(key).toString('base64url')}.json`);
    // O envelope precisa carregar o próprio vencimento: `readDiskCache` só
    // aceita o registro quando `expiresAt` é um número futuro.
    fs.writeFileSync(file, JSON.stringify({ key, storedAt: Date.now(), expiresAt: Date.now() + ttl, data }));
  } catch {
    // Cache em disco é uma economia de cota, não um requisito de funcionamento.
  }
}

async function fetchUpstream(url, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Uma chamada por chave válida. O plano gratuito da APIShort entrega 100
 * requisições por dia e a instância do Render reinicia com frequência, então o
 * resultado é guardado em memória e em disco com TTL por endpoint.
 */
export async function requestApiShort(endpoint, searchParams = {}) {
  const { head, config } = resolveEndpoint(endpoint);
  const { baseUrl, provider, apiKey } = getApiShortConfig();
  if (!apiKey) {
    throw new ApiShortError(503, 'Catálogo temporariamente indisponível. Verifique a configuração do servidor.', 'APISHORT_KEY_MISSING');
  }

  const params = pickParams(config.params, searchParams);
  if (head === 'search' && !params.q) {
    throw new ApiShortError(400, 'Informe um termo de busca.', 'APISHORT_SEARCH_TERM_MISSING');
  }
  const key = cacheKey(endpoint, params);
  const ttl = config.ttl;
  const fresh = memory.get(key);
  if (fresh && fresh.expiresAt > Date.now()) return fresh.data;
  const disk = readDiskCache(key);
  if (disk !== null) {
    usage.cacheHits += 1;
    memory.set(key, { data: disk, expiresAt: Date.now() + ttl });
    return disk;
  }
  if (fresh) memory.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const url = new URL(endpointPath(provider, endpoint), baseUrl);
  for (const [param, value] of Object.entries(params)) url.searchParams.set(param, value);

  const task = (async () => {
    const execute = async () => {
      usage.upstream += 1;
      const response = await fetchUpstream(url, apiKey);
      if (!response.ok) usage.errors[String(response.status)] = (usage.errors[String(response.status)] ?? 0) + 1;
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new ApiShortError(502, 'A APIShort retornou uma resposta que não é JSON válido.', 'APISHORT_INVALID_JSON');
      }
      if (!response.ok) {
        const message = payload?.message || payload?.error || `APIShort respondeu HTTP ${response.status}.`;
        const code = response.status === 429 ? 'APISHORT_QUOTA' : response.status >= 500 ? 'APISHORT_UPSTREAM_5XX' : 'APISHORT_UPSTREAM_ERROR';
        throw new ApiShortError(response.status, String(message).slice(0, 300), code);
      }
      return payload;
    };

    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await execute();
        memory.set(key, { data, expiresAt: Date.now() + ttl });
        writeDiskCache(key, data, ttl);
        return data;
      } catch (error) {
        lastError = error;
        const retryable = error?.code === 'APISHORT_UPSTREAM_5XX' || error?.message?.includes('não respondeu');
        if (!retryable || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    throw lastError;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

export function cacheStats() {
  return {
    entries: memory.size,
    disk: fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).length : 0,
    upstreamCalls: usage.upstream,
    cacheHits: usage.cacheHits,
    errors: usage.errors,
    desde: new Date(usage.startedAt).toISOString(),
  };
}
