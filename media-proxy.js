import { Readable } from 'node:stream';

const ALLOWED_HOSTS = new Set(['akamai-static.shorttv.live']);
const PROXY_PATH = '/media/hls?url=';

function validateMediaUrl(raw) {
  const url = raw instanceof URL ? raw : new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || !url.pathname.startsWith('/hls/')) {
    throw new Error('A URL não pertence ao CDN HLS autorizado da ShortMax.');
  }
  return url;
}

function proxiedUrl(raw, baseUrl) {
  const target = validateMediaUrl(new URL(raw, baseUrl));
  return `${PROXY_PATH}${encodeURIComponent(target.href)}`;
}

function rewritePlaylist(text, sourceUrl) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    const rewrittenAttributes = line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${proxiedUrl(uri, sourceUrl)}"`);
    if (trimmed.startsWith('#')) return rewrittenAttributes;
    return proxiedUrl(trimmed, sourceUrl);
  }).join('\n');
}

async function fetchMedia(url, req, res, redirects = 0) {
  const source = validateMediaUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const onClose = () => controller.abort();
  res.on('close', onClose);
  try {
    const headers = { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*', 'User-Agent': 'GoldDramasPreview/1.0' };
    const range = req.get('range');
    if (range) headers.Range = range;
    const upstream = await fetch(source, { headers, signal: controller.signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      if (redirects >= 3) throw new Error('Redirecionamentos do CDN excederam o limite.');
      const location = upstream.headers.get('location');
      if (!location) throw new Error('Redirecionamento do CDN sem destino.');
      return await fetchMedia(validateMediaUrl(new URL(location, source)), req, res, redirects + 1);
    }
    return { upstream, source };
  } finally {
    clearTimeout(timeout);
    res.off('close', onClose);
  }
}

export async function hlsMediaHandler(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const raw = typeof req.query.url === 'string' ? req.query.url : '';
    if (!raw || raw.length > 8192) {
      res.status(400).json({ error: 'URL de mídia ausente ou inválida.' });
      return;
    }
    const source = validateMediaUrl(raw);
    const { upstream } = await fetchMedia(source, req, res);
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({ error: 'O CDN HLS não disponibilizou este recurso.' });
      return;
    }
    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = source.pathname.toLowerCase().endsWith('.m3u8') || contentType.toLowerCase().includes('mpegurl');
    if (isPlaylist) {
      const body = await upstream.text();
      res.status(200).type('application/vnd.apple.mpegurl').send(rewritePlaylist(body, source));
      return;
    }
    res.status(upstream.status).type(contentType || 'application/octet-stream');
    for (const header of ['content-range', 'accept-ranges', 'content-length']) {
      const value = upstream.headers.get(header);
      if (value) res.set(header, value);
    }
    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.status(502).json({ error: 'Não foi possível carregar este episódio.' });
      else res.end();
    });
    body.pipe(res);
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (!res.headersSent) res.status(504);
      res.end(JSON.stringify({ error: 'Tempo esgotado ao buscar o segmento HLS.' }));
      return;
    }
    if (!res.headersSent) res.status(400).json({ error: error instanceof Error ? error.message : 'Falha no relay HLS.' });
    else res.end();
  }
}
