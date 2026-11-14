import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function mediaFallbackPlugin(): Plugin {
  return {
    name: 'drama-reels-media-fallback',
    configureServer(server) {
      server.middlewares.use('/media', async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost');
          const source = requestUrl.searchParams.get('url');
          if (!source || new URL(source).hostname !== 'cdn2.dsstv.online') {
            res.statusCode = 400;
            res.end('URL de mídia inválida.');
            return;
          }
          const upstream = await fetch(source, { headers: { Accept: 'video/mp4' } });
          if (!upstream.ok || !upstream.body) {
            res.statusCode = upstream.status || 502;
            res.end('Mídia indisponível.');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Cache-Control', 'no-store');
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
          Readable.fromWeb(upstream.body as any).pipe(ffmpeg.stdin);
        } catch (error) {
          console.error('[media fallback]', error);
          if (!res.headersSent) res.statusCode = 502;
          res.end('Falha ao preparar a mídia.');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mediaFallbackPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://api.dsstv.online',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/api/v1'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            for (const header of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) {
              proxyReq.removeHeader(header);
            }
          });
        },
      },
    },
  },
});
