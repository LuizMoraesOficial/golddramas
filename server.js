import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiShortError, requestApiShort } from './apishort.js';
import { hlsMediaHandler } from './media-proxy.js';
import { catalogMeta, describeEntry, listCatalog, lookupEntry, refreshCatalog, slugify } from './catalog.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const apiOnly = process.env.API_ONLY === '1';
const port = Number(apiOnly ? process.env.API_PORT || 3001 : process.env.PORT || 3000);
const SORTS = new Set(['destaque', 'recentes', 'vistos', 'episodios']);

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/media/hls', hlsMediaHandler);

function intParam(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(status, fallback) {
  if (status === 429) return 'A cota diária do catálogo foi atingida. Os títulos já carregados continuam disponíveis.';
  if (status === 401 || status === 403) return 'Não foi possível validar a configuração do catálogo.';
  if (status === 504) return 'O catálogo externo demorou para responder. Tente novamente em instantes.';
  return fallback;
}

app.get('/api/catalog', async (req, res) => {
  const query = {
    page: intParam(req.query.page, 1),
    limit: Math.min(intParam(req.query.limit, 30), 60),
    q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '',
    sort: SORTS.has(String(req.query.sort)) ? String(req.query.sort) : 'destaque',
    tag: typeof req.query.tag === 'string' ? slugify(req.query.tag).slice(0, 40) : '',
  };
  try {
    const result = await listCatalog(query);
    res.set('Cache-Control', 'no-store').json({
      ...result,
      dramas: result.dramas.map(describeEntry),
      catalog: await catalogMeta().catch(() => null),
    });
  } catch (error) {
    const status = error instanceof ApiShortError ? error.status : 500;
    res.status(status >= 400 && status < 500 ? status : 502).json({
      error: errorMessage(status, 'Catálogo temporariamente indisponível. Tente novamente mais tarde.'),
      dramas: [],
      pagination: { total: 0, pagina: query.page, totalPaginas: 1, mais: false },
    });
  }
});

app.get('/api/catalog/meta', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await catalogMeta());
  } catch (error) {
    const status = error instanceof ApiShortError ? error.status : 500;
    res.status(status === 429 ? 200 : 502).json({ error: errorMessage(status, 'Metadados indisponíveis.'), total: 0, tags: [] });
  }
});

// A rota de detail devolve episódios + metadados do índice em uma chamada só.
// O `id` aceito é o da variante em português retornado pelo catálogo ou pela
// busca; `alleps` também responde pelo `code` global dos itens vindos do search.
app.get('/api/catalog/detail/:id', async (req, res) => {
  const id = String(req.params.id || '').slice(0, 40);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    res.status(400).json({ error: 'Identificador inválido.' });
    return;
  }
  let payload = null;
  let upstreamError = null;
  try {
    payload = await requestApiShort(`alleps/${id}`, { lang: process.env.APISHORT_LANG || 'pt' });
  } catch (error) {
    upstreamError = error;
  }
  const data = Array.isArray(payload?.data) ? null : payload?.data ?? payload;
  if (!data) {
    const status = upstreamError instanceof ApiShortError ? upstreamError.status : 502;
    res.status(status === 429 ? 200 : status >= 400 ? status : 502).json({
      error: errorMessage(status, 'Não foi possível carregar os episódios deste título.'),
      drama: null,
    });
    return;
  }
  const mapped = describeEntry({
    id,
    code: data.code ?? id,
    nome: (typeof data.name === 'string' ? data.name : '').replace(/^\s*\[(?:dublado|dublada)\]\s*/i, ''),
    dublado: true,
    sinopse: data.summary ?? '',
    episodios: data.totalEpisodios ?? (Array.isArray(data.episodes) ? data.episodes.length : 0),
    capa: data.cover ?? '',
    generos: [],
    origem: ['alleps'],
  });
  // O enriquecimento usa só o índice já em memória: consultar a rota de busca
  // aqui duplicaria o custo de cota a cada abertura de episódio.
  const enriched = lookupEntry(id) ?? lookupEntry(data.code);
  res.set('Cache-Control', 'no-store').json({
    drama: {
      ...mapped,
      generos: enriched?.generos ?? mapped.generos,
      tags: enriched?.generos ?? mapped.tags,
      favoritos: enriched?.favoritos ?? mapped.favoritos,
      visualizacoes: enriched?.visualizacoes ?? mapped.visualizacoes,
    },
    episodes: Array.isArray(data.episodes) ? data.episodes : [],
    expires: data.expires ?? data.expires_in ?? null,
  });
});

app.post('/api/catalog/refresh', async (req, res) => {
  const token = process.env.APISHORT_REFRESH_TOKEN;
  if (!token) {
    res.status(404).json({ error: 'Rota indisponível.' });
    return;
  }
  if (req.get('authorization') !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  try {
    const index = await refreshCatalog();
    res.json({ ok: true, total: index.items.length });
  } catch (error) {
    res.status(502).json({ error: error instanceof ApiShortError ? error.message : 'Falha ao atualizar o índice.' });
  }
});

app.get('/api/*', async (req, res) => {
  const endpoint = (req.params[0] || '').replace(/^\/+|\/+$/g, '');
  const query = {};
  for (const key of ['lang', 'page', 'pageSize', 'q']) {
    const value = req.query[key];
    if (typeof value === 'string') query[key] = value.slice(0, 120);
  }
  try {
    const data = await requestApiShort(endpoint, query);
    res.set('Cache-Control', 'no-store').json(data);
  } catch (error) {
    const status = error instanceof ApiShortError ? error.status : 500;
    res.status(status).json({ error: errorMessage(status, 'Catálogo temporariamente indisponível. Tente novamente mais tarde.') });
  }
});

if (!apiOnly) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`GoldDramas ${apiOnly ? 'API' : 'app'} listening on 0.0.0.0:${port}`);
});
