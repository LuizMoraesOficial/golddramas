import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiShortError, cacheStats, requestApiShort } from './apishort.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const seedFile = path.join(root, 'data', 'dubbed-seed.json');

/**
 * Regras confirmadas contra a API real:
 * - `name` chega com o prefixo `[Dublado]` quando existe versão dublada em
 *   português; é o único sinal confiável de dublagem que o fornecedor expõe.
 * - `code` é a identidade global do drama; `id` é a identidade da variante
 *   por idioma e é o que `alleps/{id}` espera.
 * - `cover` é assinada por `auth_key`, mas o CDN entrega a mesma imagem sem o
 *   parâmetro. Removemos a assinatura para o índice não apodrecer.
 */
const DUB_MARKER = /^\s*\[(?:dublado|dublada|dublado em portugu[eê]s|dublada em portugu[eê]s)\]\s*/i;
const EXPLICIT_DUB_FIELDS = /^(\s*)(\[(?:dublado|dublada)[^\]]*\])/i;

export const LANG = process.env.APISHORT_LANG || 'pt';

// Janelas leves no primeiro carregamento; as páginas 3–7 já foram incorporadas à semente.
const WINDOWS = [
  { endpoint: 'new', query: { page: 1 }, role: 'recentes' },
  { endpoint: 'new', query: { page: 2 }, role: 'recentes' },
  { endpoint: 'popular', query: { page: 1 }, role: 'popular' },
  { endpoint: 'category/1', query: { page: 1 }, role: 'categoria' },
];
// As páginas 1–7 já estão representadas na semente de 170 títulos. Depois dela,
// cada pedido de “carregar mais” consulta uma nova página, sem pular nem repetir.
// A última página segura verificada foi a 15; a 16 respondeu com erro.
const DISCOVERY_PAGES = [8, 9, 10, 11, 12, 13, 14, 15];

// Reconstruir o índice a cada 30 minutos custaria ~240 requisições/dia contra
// um plano de 100/dia. O acervo dublado muda devagar: o padrão é 6 horas e o
// valor pode ser ajustado em CATALOG_INDEX_TTL_MINUTES.
const INDEX_TTL = Math.max(5, Number(process.env.CATALOG_INDEX_TTL_MINUTES) || 360) * 60 * 1000;

let indexCache = null;
let indexBuiltAt = 0;
let lastBuildWarnings = [];
let lastBuildError = null;
let buildPromise = null;
let discoveryCursor = 0;
let discoveryPromise = null;
let discoveryBasePages = 0;
let discoverySessionKey = '';

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function publicUrl(value) {
  const url = cleanText(value);
  if (!url.startsWith('http')) return '';
  return url.split('?')[0];
}

function tagLabels(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => (typeof tag === 'string' ? tag : cleanText(tag?.name ?? tag?.labelName ?? tag?.title)))
    .filter(Boolean);
}

function isDubbed(item) {
  const name = cleanText(item?.name ?? item?.title);
  if (DUB_MARKER.test(name) || EXPLICIT_DUB_FIELDS.test(name)) return true;
  const language = cleanText(item?.audio_language ?? item?.audioLanguage ?? item?.dub_language ?? item?.audio_lang).toLowerCase();
  const flagged = item?.dubbed === true || item?.is_dubbed === true || item?.isDubbed === true;
  return Boolean(flagged && /^(pt|pt-br|portuguese|portugu[eê]s)/i.test(language));
}

export function stripMarker(name) {
  return cleanText(name).replace(DUB_MARKER, '').replace(EXPLICIT_DUB_FIELDS, '$1').trim();
}

/**
 * O endpoint `search` devolve `summary` no idioma que o parceiro tinha salvo
 * para aquele registro, então já apareceu sinopse em alemão num título
 * marcado [Dublado]. Aceitamos o texto quando ele tem função em português;
 * sem português aparente e com dois ou mais marcadores estrangeiros, descartamos
 * (a interface então usa a frase padrão) em vez de mostrar texto noutra língua.
 */
const PT_FUNCTION = /\b(de|da|do|das|uma|um|com|para|que|não|na|no|seu|sua|é|está|estão|foi|será|vida|amor|família|casamento|filho|volta|enquanto|descobre|apenas|entre|era|tudo|quando|onde|quem|sem|sobre|depois|antes|ainda|também)\b/i;
const FOREIGN_FUNCTION = /\b(und|nicht|mit|ihr|sie|der|die|el|una|los|las|por|muy|dengan|yang|adalah|untuk|the|and|her|his|when|after)\b/gi;

function localizedSummary(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (PT_FUNCTION.test(text)) return text;
  const foreign = (text.match(FOREIGN_FUNCTION) ?? []).length;
  return foreign >= 2 ? '' : text;
}

export function normalizeEntry(item, origin = 'live') {
  if (!item || typeof item !== 'object') return null;
  const id = cleanText(String(item.id ?? item.drama_id ?? item.book_id ?? ''));
  const code = cleanText(String(item.code ?? item.book_code ?? item.drama_code ?? id));
  const rawName = cleanText(item.name ?? item.title ?? item.drama_name);
  if (!id && !code) return null;
  // `popular`/`new`/`category` devolvem `id` = variante do idioma e `code` =
  // código global; `search` devolve os dois iguais ao `id` da variante. Sem
  // unificar por qualquer identificador o mesmo título entrava duas vezes.
  const aliases = [...new Set([id, code].filter(Boolean))];
  return {
    id: id || code,
    code: code || id,
    aliases,
    nome: stripMarker(rawName),
    nomeBruto: rawName,
    dublado: isDubbed(item) || DUB_MARKER.test(rawName),
    sinopse: localizedSummary(item.summary ?? item.description ?? item.intro),
    episodios: Number(item.episodes ?? item.totalEpisodes ?? item.episode_count ?? 0) || undefined,
    visualizacoes: Number(item.views ?? 0) || undefined,
    favoritos: Number(item.favorites ?? 0) || undefined,
    capa: publicUrl(item.cover ?? item.vertical_cover ?? item.poster ?? item.image),
    generos: tagLabels(item.tags),
    tagline: cleanText(item.tagline),
    origem: [origin],
  };
}

function isSameDrama(a, b) {
  return (a?.aliases ?? []).some((value) => (b?.aliases ?? []).includes(value));
}

function isSameTitleAndCover(a, b) {
  const titleKey = (value) => cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const leftTitle = titleKey(a?.nome);
  return Boolean(leftTitle && leftTitle === titleKey(b?.nome) && a?.capa && a.capa === b?.capa);
}

function mergeEntry(target, incoming) {
  target.dublado = target.dublado || incoming.dublado;
  if (incoming.capa) target.capa = incoming.capa;
  if (incoming.sinopse && target.sinopse.length < incoming.sinopse.length) target.sinopse = incoming.sinopse;
  if (incoming.tagline && !target.tagline) target.tagline = incoming.tagline;
  if (incoming.episodios && (!target.episodios || incoming.episodios > target.episodios)) target.episodios = incoming.episodios;
  target.visualizacoes = Math.max(target.visualizacoes ?? 0, incoming.visualizacoes ?? 0) || target.visualizacoes;
  target.favoritos = Math.max(target.favoritos ?? 0, incoming.favoritos ?? 0) || target.favoritos;
  if (!target.generos?.length && incoming.generos?.length) target.generos = incoming.generos;
  for (const origin of incoming.origem ?? []) if (!target.origem.includes(origin)) target.origem.push(origin);
  for (const value of incoming.aliases ?? []) if (!target.aliases.includes(value)) target.aliases.push(value);
  // `alleps` aceita os dois formatos, mas o id próprio da variante (aquele em
  // que id e code são diferentes) é o mais estável: ele passa a ser o canônico.
  if (target.id !== incoming.id && incoming.id !== incoming.code && target.id === target.code) {
    target.id = incoming.id;
  }
  return target;
}

function readSeed() {
  try {
    const raw = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const entries = [];
    for (const item of items) {
      const entry = normalizeEntry({
        id: item.id ?? item.code,
        code: item.code ?? item.id,
        name: item.dublado === false ? item.name : `[Dublado] ${item.name}`,
        summary: item.summary,
        episodes: item.episodes,
        views: item.views,
        favorites: item.favorites,
        cover: item.cover,
        tags: item.tags,
        tagline: item.tagline,
      }, 'seed');
      if (entry) entries.push(entry);
    }
    return { entries, geradoEm: raw?.geradoEm ?? null, tags: Array.isArray(raw?.tags) ? raw.tags : [] };
  } catch {
    return { entries: [], geradoEm: null, tags: [] };
  }
}

function rowsOf(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : null;
  if (data) return data;
  for (const key of ['list', 'items', 'books', 'dramas']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function buildIndex() {
  discoveryCursor = 0;
  discoveryBasePages = 0;
  discoverySessionKey = '';
  const warnings = [];
  const index = new Map();
  const byAlias = new Map();
  const seed = readSeed();

  const put = (entry) => {
    if (!entry) return false;
    let canonical = null;
    for (const value of entry.aliases) {
      if (byAlias.has(value)) { canonical = index.get(byAlias.get(value)); break; }
    }
    if (canonical) {
      mergeEntry(canonical, entry);
      for (const value of entry.aliases) if (!byAlias.has(value)) byAlias.set(value, canonical.code || canonical.id);
      return false;
    }
    const key = entry.code || entry.id;
    if (!key) return false;
    index.set(key, entry);
    for (const value of entry.aliases) byAlias.set(value, key);
    return true;
  };

  for (const entry of seed.entries) put(entry);
  const seedCount = index.size;

  // Uma janela que falha não pode derrubar o catálogo: o índice anterior e a
  // semente continuam servindo enquanto o upstream estiver fora ou sem cota.
  const results = await Promise.allSettled(
    WINDOWS.map((win) => requestApiShort(win.endpoint, { lang: LANG, ...win.query }).then((payload) => ({ win, payload }))),
  );

  let liveCount = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { win, payload } = result.value;
      let accepted = 0;
      for (const row of rowsOf(payload)) {
        const entry = normalizeEntry(row, 'live');
        if (!entry || !isDubbed(row)) continue;
        if (put(entry)) accepted += 1;
      }
      liveCount += accepted;
      continue;
    }
    const error = result.reason;
    const label = error instanceof ApiShortError ? `${error.status} ${error.code ?? ''}`.trim() : 'falha';
    warnings.push(`janela indisponível (${label})`);
    lastBuildError = error;
  }

  const items = [...index.values()].filter((entry) => entry.dublado && entry.nome);
  const tags = collectTags(items);
  indexCache = { items, tags, seedCount, liveCount, builtAt: Date.now() };
  indexBuiltAt = Date.now();
  lastBuildWarnings = warnings;
  return indexCache;
}

function collectTags(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.generos ?? []) {
      const label = cleanText(tag);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nome, count]) => ({ nome, slug: slugify(nome), count }));
}

export function slugify(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function getIndex({ force = false } = {}) {
  if (!force && indexCache && Date.now() - indexBuiltAt < INDEX_TTL) return indexCache;
  if (!buildPromise) {
    buildPromise = buildIndex().finally(() => { buildPromise = null; });
  }
  try {
    return await buildPromise;
  } catch (error) {
    // Construção falhou por completo: mantém o índice anterior, mesmo vencido.
    if (indexCache) return indexCache;
    throw error;
  }
}

function compareBy(sort) {
  if (sort === 'recentes') return (a, b) => Number(b.id) - Number(a.id) || a.nome.localeCompare(b.nome, 'pt-BR');
  if (sort === 'vistos') return (a, b) => (b.visualizacoes ?? 0) - (a.visualizacoes ?? 0) || (b.favoritos ?? 0) - (a.favoritos ?? 0) || Number(b.id) - Number(a.id);
  if (sort === 'episodios') return (a, b) => (b.episodios ?? 0) - (a.episodios ?? 0) || (b.visualizacoes ?? 0) - (a.visualizacoes ?? 0);
  return (a, b) => (b.favoritos ?? 0) - (a.favoritos ?? 0) || (b.visualizacoes ?? 0) - (a.visualizacoes ?? 0) || Number(b.id) - Number(a.id);
}

function searchKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesLocal(entry, term) {
  const needle = searchKey(term);
  if (!needle) return true;
  const haystack = `${searchKey(entry.nome)} ${searchKey(entry.sinopse)} ${(entry.generos ?? []).map(searchKey).join(' ')}`;
  const words = needle.split(' ').filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

export function pickFromIndex(items, { sort = 'destaque', tag = '' } = {}) {
  const list = tag ? items.filter((entry) => (entry.generos ?? []).some((label) => slugify(label) === tag)) : items;
  return [...list].sort(compareBy(sort));
}

/**
 * Busca em duas camadas, na ordem:
 * 1. `search?lang=pt&q=` na nuvem: devolve variantes de todos os idiomas e só
 *    as marcadas com [Dublado] são aproveitadas. É o que encontra títulos que
 *    ainda não entraram no índice.
 * 2. índice local: cobre o resto do dia quando a cota da busca acabou.
 */
export async function searchCatalog(term, { sort = 'destaque', tag = '' } = {}) {
  const query = cleanText(term);
  // O índice local é o plano de fallback da busca: se a cota do dia acabou ou
  // o upstream cair, ainda respondemos com os títulos já conhecidos.
  await getIndex().catch(() => null);
  const base = pickFromIndex(getIndexSync().items, { sort, tag });
  const merged = new Map();
  let remoteStatus = 'ignorada';

  if (query) {
    try {
      const payload = await requestApiShort('search', { lang: LANG, q: query });
      const remote = rowsOf(payload)
        .map((row) => normalizeEntry(row, 'busca'))
        .filter((entry) => entry && isDubbed({ name: entry.nomeBruto }));
      for (const entry of remote) {
        const known = [...merged.values()].find((item) => isSameDrama(item, entry))
          ?? base.find((item) => isSameDrama(item, entry));
        // Cópia defensiva: mergeEntry enriquece originais/aliases e o índice
        // base não pode ser alterado por uma consulta de busca.
        const clone = known ? { ...known, origem: [...known.origem], aliases: [...known.aliases], generos: [...(known.generos ?? [])] } : entry;
        merged.set(clone.code || clone.id, known ? mergeEntry(clone, entry) : clone);
      }
      remoteStatus = remote.length ? 'remota' : 'remota-vazia';
    } catch (error) {
      remoteStatus = error instanceof ApiShortError && error.status === 429 ? 'sem-cota' : 'indisponivel';
    }
  }

  const remoteEntries = [...merged.values()];
  const localExtra = base.filter((entry) => !remoteEntries.some((remote) => isSameDrama(remote, entry)) && matchesLocal(entry, query));
  return {
    items: [...remoteEntries, ...localExtra],
    remoteStatus,
    // As duas contagens deixam a interface honesta: dizem quantos vieram da
    // nuvem e quantos saíram do acervo já registrado no servidor.
    remoteCount: remoteEntries.length,
    localCount: localExtra.length,
  };
}

function getIndexSync() {
  return indexCache ?? { items: [], tags: [] };
}

/** Consulta apenas o índice em memória, sem gastar requisições da API externa. */
export function lookupEntry(idOrCode) {
  const key = cleanText(String(idOrCode ?? ''));
  if (!key || !indexCache) return null;
  return indexCache.items.find((entry) => (entry.aliases ?? []).some((alias) => String(alias) === key)) ?? null;
}

export async function listCatalog({ page = 1, limit = 30, q = '', sort = 'destaque', tag = '' } = {}) {
  const query = cleanText(q);
  if (query) {
    const { items, remoteStatus, remoteCount, localCount } = await searchCatalog(query, { sort, tag });
    return pageSlice(items, { page, limit }, {
      busca: { termo: query, origem: remoteStatus, total: items.length, remotos: remoteCount, locais: localCount },
    });
  }
  await getIndex();
  const items = pickFromIndex(getIndexSync().items, { sort, tag });
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 6), 60);
  const safePage = Math.max(Number(page) || 1, 1);
  const sessionKey = `${sort}|${tag}|${safeLimit}`;
  if (safePage === 1 || discoverySessionKey !== sessionKey || !discoveryBasePages) {
    discoverySessionKey = sessionKey;
    discoveryBasePages = Math.max(1, Math.ceil(items.length / safeLimit));
  }

  if (tag || safePage <= discoveryBasePages) {
    return pageSlice(items, { page, limit }, {
      busca: null,
      externalMore: !tag && safePage >= discoveryBasePages && discoveryCursor < DISCOVERY_PAGES.length,
    });
  }

  // Uma solicitação do botão/rolagem consulta no máximo uma página nova.
  // Assim, respostas repetidas não encerram o fluxo nem provocam uma varredura
  // automática de várias páginas em uma única ação.
  const discovered = await discoverNextPage();
  const additions = pickFromIndex(discovered, { sort, tag });
  const more = discoveryCursor < DISCOVERY_PAGES.length;
  return {
    dramas: additions,
    pagination: {
      total: getIndexSync().items.length,
      pagina: safePage,
      totalPaginas: more ? safePage + 1 : safePage,
      mais: more,
    },
    busca: null,
  };
}

async function discoverNextPage() {
  if (!indexCache || discoveryCursor >= DISCOVERY_PAGES.length) return [];
  if (discoveryPromise) return discoveryPromise;

  const page = DISCOVERY_PAGES[discoveryCursor++];
  discoveryPromise = (async () => {
    try {
      const payload = await requestApiShort('new', { lang: LANG, page });
      const discovered = [];
      for (const row of rowsOf(payload)) {
        const incoming = normalizeEntry(row, `new:${page}`);
        if (!incoming || !isDubbed(row)) continue;
        const known = indexCache.items.find((entry) => isSameDrama(entry, incoming) || isSameTitleAndCover(entry, incoming));
        if (known) mergeEntry(known, incoming);
        else {
          indexCache.items.push(incoming);
          indexCache.liveCount += 1;
          discovered.push(incoming);
        }
      }
      indexCache.tags = collectTags(indexCache.items);
      return discovered;
    } catch (error) {
      const label = error instanceof ApiShortError ? `${error.status} ${error.code ?? ''}`.trim() : 'falha';
      lastBuildWarnings = [...lastBuildWarnings, `descoberta page=${page} indisponível (${label})`];
      lastBuildError = error;
      // Um erro upstream não deve resultar em tentativas automáticas a cada scroll.
      discoveryCursor = DISCOVERY_PAGES.length;
      return [];
    }
  })().finally(() => { discoveryPromise = null; });
  return discoveryPromise;
}

function pageSlice(items, { page, limit }, extra) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 6), 60);
  const safePage = Math.max(Number(page) || 1, 1);
  const start = (safePage - 1) * safeLimit;
  const paginasAtuais = Math.max(1, Math.ceil(items.length / safeLimit));
  const { externalMore = false, ...responseExtra } = extra;
  const totalPaginas = paginasAtuais + (externalMore ? 1 : 0);
  return {
    dramas: items.slice(start, start + safeLimit),
    pagination: {
      total: items.length,
      pagina: safePage,
      totalPaginas,
      mais: safePage < paginasAtuais || Boolean(externalMore),
    },
    ...responseExtra,
  };
}

export async function catalogMeta({ force = false } = {}) {
  const index = await getIndex({ force }).catch((error) => {
    if (indexCache) return indexCache;
    throw error;
  });
  const seed = readSeed();
  return {
    total: index.items.length,
    semente: index.seedCount,
    aoVivo: index.liveCount,
    construidoEm: new Date(index.builtAt).toISOString(),
    sementeGeradaEm: seed.geradoEm,
    tags: index.tags,
    avisos: lastBuildWarnings,
    erro: lastBuildError instanceof ApiShortError
      ? { status: lastBuildError.status, code: lastBuildError.code }
      : lastBuildError ? { status: 502 } : null,
    janelas: WINDOWS.map((win) => `${win.endpoint}?page=${win.query.page}`),
    paginasSobDemanda: DISCOVERY_PAGES.slice(discoveryCursor),
    idioma: LANG,
    uso: cacheStats(),
  };
}

export async function refreshCatalog() {
  lastBuildError = null;
  return buildIndex();
}

export function describeEntry(entry) {
  return {
    _id: entry.id,
    code: entry.code,
    titulo: entry.nome,
    slug: '',
    sinopse: entry.sinopse,
    tipo: 'shortDrama',
    idioma: LANG,
    idiomaTagManual: 'Dublado em português',
    capaPrincipal: entry.capa,
    capaVertical: entry.capa,
    thumbnail: entry.capa,
    totalEpisodios: entry.episodios,
    generos: entry.generos ?? [],
    tags: entry.generos ?? [],
    visualizacoes: entry.visualizacoes,
    favoritos: entry.favoritos,
    dublado: entry.dublado,
    origem: entry.origem,
  };
}
