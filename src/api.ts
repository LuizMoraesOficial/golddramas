import type { Category, Drama, Episode, Pagination } from './types';

const API_ROOT = '/api';
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function firstString(source: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = payload && typeof payload === 'object' ? (payload as UnknownRecord).error : null;
    throw new Error(typeof error === 'string' ? error : `O servidor respondeu HTTP ${response.status}.`);
  }
  return payload as T;
}

export async function ensureVisitor() { /* A autenticação é feita exclusivamente pelo servidor. */ }
export function resetVisitor(_rotateDevice = false) { /* Não há credenciais armazenadas no navegador. */ }

type CatalogResponse = {
  dramas?: unknown[];
  pagination?: { total?: number; pagina?: number; totalPaginas?: number; mais?: boolean };
  catalog?: unknown;
  busca?: { termo?: string; origem?: string; total?: number; remotos?: number; locais?: number } | null;
  error?: string;
};

const clientCache = new Map<string, Promise<CatalogResponse>>();

function fetchCatalog(params: URLSearchParams): Promise<CatalogResponse> {
  const key = params.toString();
  let pending = clientCache.get(key);
  if (!pending) {
    pending = request<CatalogResponse>(`/catalog?${params}`).catch((error) => {
      clientCache.delete(key);
      throw error;
    });
    clientCache.set(key, pending);
  }
  return pending;
}

function normalizeEpisode(value: unknown, index: number): Episode {
  const item = asRecord(value);
  const video = asRecord(item.video);
  const urlVideo = firstString(video, ['video_720', 'video_480', 'video_1080'])
    || firstString(item, ['video_url', 'videoUrl', 'url', 'play_url', 'playUrl']);
  return {
    _id: firstString(item, ['id', 'episode_id', 'vid']),
    numero: Number(item.episode ?? item.number ?? item.episode_number ?? item.index ?? index + 1) || index + 1,
    titulo: firstString(item, ['title', 'name', 'episode_title']) || `Episódio ${index + 1}`,
    descricao: firstString(item, ['description', 'desc']),
    thumbnail: firstString(item, ['thumbnail', 'cover', 'image']),
    duracaoSegundos: Number(item.duration ?? item.duracaoSegundos ?? item.duration_seconds ?? 0) || undefined,
    urlVideo,
    urlVideoExpiraEm: Number(item.expires ?? item.video_expires ?? 0) || undefined,
  };
}

function labelsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? entry : firstString(asRecord(entry), ['name', 'title', 'label'])).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeDrama(value: unknown): Drama {
  const item = asRecord(value);
  const labels = labelsOf(item.generos ?? item.tags ?? item.categories);
  const capa = firstString(item, ['capaPrincipal', 'capa', 'cover']);
  return {
    _id: firstString(item, ['_id', 'id', 'drama_id', 'code']),
    code: firstString(item, ['code']) || undefined,
    titulo: firstString(item, ['titulo', 'title', 'name', 'drama_name']) || 'Título não informado',
    slug: firstString(item, ['slug']) || undefined,
    sinopse: firstString(item, ['sinopse', 'summary', 'description', 'intro']) || undefined,
    tipo: firstString(item, ['tipo']) || 'shortDrama',
    idioma: 'pt',
    idiomaTagManual: 'Dublado em português',
    dublado: item.dublado !== false,
    capaPrincipal: capa || undefined,
    capaVertical: firstString(item, ['capaVertical']) || capa || undefined,
    thumbnail: firstString(item, ['thumbnail']) || capa || undefined,
    totalEpisodios: Number(item.totalEpisodios ?? item.episodios ?? 0) || undefined,
    generos: labels,
    tags: labels,
    visualizacoes: Number(item.visualizacoes ?? 0) || undefined,
    favoritos: Number(item.favoritos ?? 0) || undefined,
    destaque: Boolean(item.destaque),
    novo: Boolean(item.novo),
    temporadas: [],
  };
}

export type CatalogInfo = {
  total: number;
  tags: Category[];
  avisos: string[];
  atualizadoEm?: string;
};

export type SearchInfo = {
  termo: string;
  origem: string;
  remotos: number;
  locais: number;
};

let lastCatalogInfo: CatalogInfo = { total: 0, tags: [], avisos: [] };

export function getCatalogInfo() {
  return lastCatalogInfo;
}

function rememberCatalog(source: unknown) {
  const catalog = asRecord(source ?? {});
  const info: CatalogInfo = {
    total: Number(catalog.total ?? 0) || lastCatalogInfo.total,
    tags: Array.isArray(catalog.tags)
      ? catalog.tags.map((tag) => ({ nome: firstString(asRecord(tag), ['nome', 'name']), slug: firstString(asRecord(tag), ['slug']), count: Number(asRecord(tag).count ?? 0) || undefined }))
      : lastCatalogInfo.tags,
    avisos: Array.isArray(catalog.avisos) ? catalog.avisos.map(String) : [],
    atualizadoEm: firstString(catalog, ['construidoEm']) || undefined,
  };
  if (info.tags.some((tag) => !tag.nome || !tag.slug)) {
    info.tags = info.tags.filter((tag) => tag.nome && tag.slug);
  }
  lastCatalogInfo = info;
}

export async function listCategories(): Promise<Category[]> {
  try {
    rememberCatalog(await request<UnknownRecord>('/catalog/meta'));
    return lastCatalogInfo.tags;
  } catch {
    return lastCatalogInfo.tags;
  }
}

export async function listDramas(page = 1, limit = 30, search = '', sort = 'destaque', tag = '') {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
  if (search.trim()) params.set('q', search.trim());
  if (tag) params.set('tag', tag);
  const payload = await fetchCatalog(params);
  rememberCatalog(payload.catalog);
  const pagination: Pagination = {
    total: Number(payload.pagination?.total ?? 0) || 0,
    pagina: Number(payload.pagination?.pagina ?? page) || page,
    totalPaginas: Number(payload.pagination?.totalPaginas ?? 1) || 1,
    mais: Boolean(payload.pagination?.mais),
  };
  const busca: SearchInfo | null = payload.busca
    ? {
      termo: payload.busca.termo ?? search,
      origem: payload.busca.origem ?? 'local',
      remotos: Number(payload.busca.remotos ?? 0) || 0,
      locais: Number(payload.busca.locais ?? 0) || 0,
    }
    : null;
  return {
    dramas: (payload.dramas ?? []).map(normalizeDrama).filter((drama) => drama._id),
    pagination,
    busca,
    aviso: payload.error,
  };
}

type DetailResponse = { drama?: unknown; episodes?: unknown[]; error?: string };

export async function getDrama(id: string): Promise<Drama> {
  let payload: DetailResponse;
  try {
    payload = await request<DetailResponse>(`/catalog/detail/${encodeURIComponent(id)}`);
  } catch (error) {
    throw new Error(error instanceof Error && error.message ? error.message : 'Não foi possível abrir este dorama.');
  }
  if (!payload.drama) throw new Error(payload.error || 'Este título não está disponível no momento.');
  const base = normalizeDrama(payload.drama);
  const episodes = (payload.episodes ?? []).map(normalizeEpisode);
  if (!episodes.some((episode) => episode.urlVideo)) {
    throw new Error(payload.error || 'Este título ainda não tem episódios disponíveis para reprodução.');
  }
  return {
    ...base,
    _id: id,
    totalEpisodios: episodes.length || base.totalEpisodios,
    temporadas: episodes.length ? [{ numero: 1, titulo: 'Episódios', episodios: episodes }] : [],
  };
}
