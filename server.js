import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiShortError, requestApiShort } from './apishort.js';
import { hlsMediaHandler } from './media-proxy.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const apiOnly = process.env.API_ONLY === '1';
const port = Number(apiOnly ? process.env.API_PORT || 3001 : process.env.PORT || 3000);
const catalogCache = new Map();

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/media/hls', hlsMediaHandler);

app.get('/api/*', async (req, res) => {
  const endpoint = (req.params[0] || '').replace(/^\/+|\/+$/g, '');
  const query = {};
  for (const key of ['lang', 'page']) {
    const value = req.query[key];
    if (typeof value === 'string') query[key] = value.slice(0, 80);
  }
  const cacheable = /^(popular|new|hot|category\/[A-Za-z0-9_-]+)$/.test(endpoint);
  const cacheKey = `${endpoint}?${new URLSearchParams(query).toString()}`;
  const cached = cacheable ? catalogCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) {
    res.set('Cache-Control', 'no-store').json(cached.data);
    return;
  }
  if (cached) catalogCache.delete(cacheKey);
  try {
    const data = await requestApiShort(endpoint, query);
    if (cacheable) catalogCache.set(cacheKey, { data, expiresAt: Date.now() + 120_000 });
    res.set('Cache-Control', 'no-store').json(data);
  } catch (error) {
    const status = error instanceof ApiShortError ? error.status : 500;
    res.status(status).json({
      error: status === 401 || status === 403
        ? 'Não foi possível validar a configuração do catálogo.'
        : 'Catálogo temporariamente indisponível. Tente novamente mais tarde.',
    });
  }
});

if (!apiOnly) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`GoldDramas ${apiOnly ? 'API' : 'app'} listening on 0.0.0.0:${port}`);
});
