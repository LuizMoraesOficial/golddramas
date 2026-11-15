import type { Category, Drama, Episode } from './types';

const API_ROOT = '/api';
const PORTUGUESE_DUB_MARKER = /^\s*\[(?:dublado|dublada|dublado em português|dublada em português)\]\s*/i;
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

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const object = asRecord(current);
    const next = object.data ?? object.result ?? object.response;
    if (next === undefined) break;
    current = next;
  }
  return current;
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) return unwrapped;
  const record = asRecord(unwrapped);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function hasPortugueseDubMarker(value: unknown) {
  const item = asRecord(value);
  const title = firstString(item, ['name', 'title', 'drama_name', 'book_name']);
  if (PORTUGUESE_DUB_MARKER.test(title)) return true;
  const explicitLanguage = firstString(item, ['audio_language', 'audioLanguage', 'dub_language', 'dubLanguage', 'audio_lang']).toLowerCase();
  const explicitDub = item.dubbed === true || item.is_dubbed === true || item.isDubbed === true;
  return explicitDub && /^(pt|pt-br|portuguese|português)(\b|[-_])/i.test(explicitLanguage);
}

function normalizeEpisode(value: unknown, index: number): Episode {
  const item = asRecord(value);
  const video = asRecord(item.video);
  const urlVideo = firstString(item, ['video_url', 'videoUrl', 'url', 'play_url', 'playUrl'])
    || firstString(video, ['video_720', 'video_480', 'video_1080']);
  return {
    _id: firstString(item, ['id', 'episode_id', 'episodeId', 'vid']),
    numero: Number(item.number ?? item.episode ?? item.episode_number ?? item.index ?? index + 1) || index + 1,
    titulo: firstString(item, ['title', 'name', 'episode_title']) || `Episódio ${index + 1}`,
    descricao: firstString(item, ['description', 'desc']),
    thumbnail: firstString(item, ['thumbnail', 'cover', 'image', 'thumb']),
    duracaoSegundos: Number(item.duration ?? item.duration_seconds ?? 0) || undefined,
    urlVideo,
    urlVideoExpiraEm: Number(item.expires ?? item.video_expires ?? 0) || undefined,
  };
}

function normalizeDrama(value: unknown, index: number): Drama {
  const item = asRecord(value);
  const rawEpisodes = arrayFrom(item, ['episodes', 'episode_list', 'episodeList', 'videos']);
  const categoryValue = item.categories ?? item.category ?? item.tags ?? item.genres;
  const labels = Array.isArray(categoryValue)
    ? categoryValue.map((entry) => typeof entry === 'string' ? entry : firstString(asRecord(entry), ['name', 'title', 'labelName'])).filter(Boolean)
    : typeof categoryValue === 'string' ? [categoryValue] : [];
  const sourceTitle = firstString(item, ['title', 'name', 'drama_name', 'book_name']) || 'Título não informado';
  return {
    _id: firstString(item, ['id', 'drama_id', 'dramaId', 'book_id', 'bookId', 'short_play_id', 'code']) || `shortmax-${index}`,
    titulo: sourceTitle.replace(PORTUGUESE_DUB_MARKER, ''),
    slug: firstString(item, ['slug']),
    sinopse: firstString(item, ['description', 'desc', 'synopsis', 'intro', 'summary']),
    tipo: 'shortDrama',
    idioma: 'pt',
    idiomaTagManual: 'Dublado em português',
    anoLancamento: Number(item.year ?? item.release_year) || undefined,
    capaPrincipal: firstString(item, ['cover', 'cover_url', 'poster', 'image', 'vertical_cover']),
    capaVertical: firstString(item, ['vertical_cover', 'cover', 'cover_url', 'poster', 'image']),
    thumbnail: firstString(item, ['thumbnail', 'thumb']),
    trailer: firstString(item, ['trailer']),
    totalEpisodios: Number(item.episode_count ?? item.total_episodes ?? item.totalEpisodes ?? (typeof item.episodes === 'number' ? item.episodes : rawEpisodes.length)) || undefined,
    generos: labels,
    tags: labels,
    novo: Boolean(item.is_new ?? item.new),
    destaque: Boolean(item.featured ?? item.is_hot),
    temporadas: rawEpisodes.length ? [{ numero: 1, titulo: 'Episódios', episodios: rawEpisodes.map(normalizeEpisode) }] : [],
  };
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

export async function listCategories(): Promise<Category[]> {
  // A documentação ShortMax lista category/{id}, mas não publica um índice completo de categorias.
  return [];
}

const catalogCache = new Map<string, Promise<unknown>>();

async function loadCatalogSource(route: string, page: number) {
  const key = `${route}:${page}`;
  let pending = catalogCache.get(key);
  if (!pending) {
    pending = request<unknown>(`/${route}?lang=pt&page=${page}`);
    catalogCache.set(key, pending);
  }
  try {
    return await pending;
  } catch (error) {
    catalogCache.delete(key);
    throw error;
  }
}

export async function listDramas(page = 1, _limit = 30, search = '', _tipo = '', category = '', _free = false) {
  const sources: Array<[string, number]> = category === '__new__'
    ? [['new', 1], ['new', 2]]
    : category === '__hot__'
      ? [['hot', 1]]
      : category === '__category1__'
        ? [['category/1', 1]]
        : [['popular', 1], ['new', 1], ['new', 2], ['category/1', 1]];
  const payloads: unknown[] = [];
  for (const [route, sourcePage] of sources) {
    payloads.push(await loadCatalogSource(route, sourcePage));
  }
  const rows = payloads.flatMap((payload) => arrayFrom(payload, ['dramas', 'list', 'items', 'books', 'data']));
  const seenIds = new Set<string>();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const dramas = rows
    .filter(hasPortugueseDubMarker)
    .filter((value) => {
      const item = asRecord(value);
      const id = firstString(item, ['id', 'drama_id', 'dramaId', 'book_id', 'bookId', 'code']) || firstString(item, ['name', 'title']);
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    })
    .map(normalizeDrama)
    .filter((drama) => !normalizedSearch || drama.titulo.toLocaleLowerCase().includes(normalizedSearch));
  return { dramas, pagination: { total: dramas.length, pagina: page, totalPaginas: 1 } };
}

export async function getDrama(id: string): Promise<Drama> {
  // ShortMax retorna metadados, episódios e URLs HLS assinadas juntos em alleps/{id}.
  const payload = await request<unknown>(`/alleps/${encodeURIComponent(id)}?lang=pt`);
  const detail = unwrap(payload);
  if (!hasPortugueseDubMarker(detail)) {
    throw new Error('Este título não está identificado como dublado em português pelo catálogo.');
  }
  const drama = normalizeDrama(detail, 0);
  const episodes = arrayFrom(payload, ['episodes', 'episode_list', 'episodeList', 'videos', 'list', 'items']).map(normalizeEpisode);
  return {
    ...drama,
    _id: id,
    temporadas: episodes.length ? [{ numero: 1, titulo: 'Episódios', episodios: episodes }] : [],
    totalEpisodios: episodes.length || drama.totalEpisodios,
  };
}
