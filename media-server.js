import express from 'express';
import { hlsMediaHandler } from './media-proxy.js';

const app = express();
const port = Number(process.env.MEDIA_PORT || 3002);
app.disable('x-powered-by');
app.get('/media/hls', hlsMediaHandler);
app.listen(port, '0.0.0.0', () => {
  console.log(`GoldDramas HLS relay listening on 0.0.0.0:${port}`);
});
