import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiBase = 'https://api.dsstv.online/api/v1';
const root = path.dirname(fileURLToPath(import.meta.url));
const managedLogin = process.env.GOLDDRAMAS_LOGIN || process.env.LOGIN || '';
const managedPassword = process.env.GOLDDRAMAS_SENHA || process.env.SENHA || '';
const managedAccountEnabled = Boolean(managedLogin && managedPassword);
let managedSession = null;
let managedSessionPromise = null;

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) * 1000;
  } catch {
    return Date.now() + 15 * 60 * 1000;
  }
}

async function loginManagedAccount() {
  if (!managedAccountEnabled) return null;
  const upstream = await fetch(`${apiBase}/auth/app/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: managedLogin, senha: managedPassword }),
  });
  const payload = await upstream.json().catch(() => ({}));
  const token = payload?.dados?.token;
  if (!upstream.ok || payload?.sucesso === false || !token) {
    console.error(`[auth] login privado recusado (HTTP ${upstream.status})`);
    throw new Error('Não foi possível autenticar a conta privada configurada no serviço.');
  }
  return {
    token,
    cliente: payload.dados.cliente || null,
    expiresAt: tokenExpiry(token),
  };
}

async function getManagedSession() {
  if (!managedAccountEnabled) return null;
  if (managedSession && managedSession.expiresAt > Date.now() + 60_000) return managedSession;
  if (!managedSessionPromise) {
    managedSessionPromise = loginManagedAccount()
      .then((session) => { managedSession = session; return session; })
      .finally(() => { managedSessionPromise = null; });
  }
  return managedSessionPromise;
}

function clearManagedSession() {
  managedSession = null;
}

app.get('/media', async (req, res) => {
  try {
    const source = String(req.query.url || '');
    if (!source || new URL(source).hostname !== 'cdn2.dsstv.online') {
      res.status(400).send('URL de mídia inválida.');
      return;
    }
    const upstream = await fetch(source, { headers: { Accept: 'video/mp4' } });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).send('Mídia indisponível.');
      return;
    }
    res.status(200).type('video/mp4').set('Cache-Control', 'no-store');
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', 'pipe:1',
    ]);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', (chunk) => console.error('[media fallback]', chunk.toString()));
    res.on('close', () => ffmpeg.kill('SIGKILL'));
    Readable.fromWeb(upstream.body).pipe(ffmpeg.stdin);
  } catch (error) {
    console.error('[media fallback]', error);
    if (!res.headersSent) res.status(502);
    res.end('Falha ao preparar a mídia.');
  }
});

async function proxyApi(req, res, retried = false) {
  const forwardedPath = req.originalUrl.replace(/^\/api/, '');
  const usesManagedAccount = managedAccountEnabled && forwardedPath.startsWith('/app/');

  try {
    if (managedAccountEnabled && forwardedPath === '/auth/app/visitante') {
      const session = await getManagedSession();
      res.status(200).json({
        sucesso: true,
        dados: {
          token: 'managed-account-session',
          visitante: false,
          cliente: session?.cliente || null,
        },
      });
      return;
    }

    const session = usesManagedAccount ? await getManagedSession() : null;
    const headers = {
      Accept: req.get('accept') || 'application/json',
      ...(session?.token
        ? { Authorization: `Bearer ${session.token}` }
        : (req.get('authorization') ? { Authorization: req.get('authorization') } : {})),
      ...(req.get('x-video-formato') ? { 'X-Video-Formato': req.get('x-video-formato') } : {}),
      ...(req.get('x-stream-session') ? { 'x-stream-session': req.get('x-stream-session') } : {}),
      ...(req.is('application/json') ? { 'Content-Type': 'application/json' } : {}),
    };
    const init = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '{}';
    }
    const upstream = await fetch(`${apiBase}${forwardedPath}`, init);
    if (usesManagedAccount && upstream.status === 401 && !retried) {
      clearManagedSession();
      return proxyApi(req, res, true);
    }
    const text = await upstream.text();
    res.status(upstream.status);
    res.type(upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    console.error('API proxy error:', error instanceof Error ? error.message : error);
    res.status(502).json({ sucesso: false, mensagem: 'Não foi possível autenticar ou alcançar o servidor de conteúdo.' });
  }
}

app.use('/api', proxyApi);
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Drama Reels listening on 0.0.0.0:${port} · conta privada: ${managedAccountEnabled ? 'habilitada' : 'desabilitada'}`));
