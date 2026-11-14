import type { Category, Drama, DramaPage, StreamResponse } from './types';

const API_ROOT = '/api';
const TOKEN_KEY = 'drama_reels_token';
const DEVICE_KEY = 'drama_reels_device';
let visitorPromise: Promise<void> | null = null;

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function resetVisitor(rotateDevice = false) {
  sessionStorage.removeItem(TOKEN_KEY);
  if (rotateDevice) localStorage.removeItem(DEVICE_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  Object.entries(extraHeaders).forEach(([key, value]) => headers.set(key, value));

  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  const data = (await response.json()) as T & { mensagem?: string; sucesso?: boolean };
  if (!response.ok || data.sucesso === false) {
    throw new Error(data.mensagem || `O servidor respondeu ${response.status}.`);
  }
  return data;
}

export async function ensureVisitor() {
  if (getToken()) return;
  if (visitorPromise) return visitorPromise;
  visitorPromise = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await request<{ sucesso: boolean; dados: { token: string } }>('/auth/app/visitante', {
          method: 'POST',
          body: JSON.stringify({ deviceId: getDeviceId() }),
        });
        setToken(response.dados.token);
        return;
      } catch (error) {
        lastError = error;
        resetVisitor(true);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Não foi possível iniciar a sessão visitante.');
  })();
  return visitorPromise.finally(() => {
    visitorPromise = null;
  });
}

export async function listCategories() {
  await ensureVisitor();
  const response = await request<{ sucesso: boolean; dados: Category[] }>('/app/categorias');
  const seen = new Set<string>();
  return response.dados.filter((category) => {
    if (category.tipo === 'secao') return false;
    const key = category.nome.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listDramas(page = 1, limit = 30, busca = '', tipo = '', categoria = '', gratis = false) {
  await ensureVisitor();
  const search = busca ? `&busca=${encodeURIComponent(busca)}` : '';
  const filter = tipo ? `&tipo=${encodeURIComponent(tipo)}` : '';
  const category = categoria ? `&categoria=${encodeURIComponent(categoria)}` : '';
  const free = gratis ? '&gratis=true' : '';
  const response = await request<DramaPage>(`/app/dramas?pagina=${page}&limite=${limit}${search}${filter}${category}${free}`);
  return { dramas: response.dados, pagination: response.paginacao };
}

export async function listSeedDramas() {
  const response = await fetch('/catalog-seed.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Cache inicial indisponível.');
  const data = (await response.json()) as DramaPage;
  return { dramas: data.dados, pagination: data.paginacao };
}

export async function getDrama(id: string) {
  await ensureVisitor();
  const response = await request<{ sucesso: boolean; dados: Drama }>(`/app/dramas/${id}`);
  return response.dados;
}

export async function startStream(dramaId: string, seasonNumber: number, episodeNumber: number, format = 'mp4') {
  await ensureVisitor();
  const body = JSON.stringify({ dramaId, temporadaNumero: seasonNumber, episodioNumero: episodeNumber });
  let response: StreamResponse;
  try {
    response = await request<StreamResponse>('/app/stream/iniciar', {
      method: 'POST',
      body,
    }, { 'X-Video-Formato': format });
  } catch (firstError) {
    resetVisitor(true);
    await ensureVisitor();
    try {
      response = await request<StreamResponse>('/app/stream/iniciar', {
        method: 'POST',
        body,
      }, { 'X-Video-Formato': format });
    } catch {
      throw firstError;
    }
  }
  return response.dados || {};
}

export async function heartbeat(streamSessionId?: string) {
  const headers: Record<string, string> = {};
  if (streamSessionId) headers['x-stream-session'] = streamSessionId;
  await request('/app/stream/heartbeat', { method: 'POST', body: JSON.stringify({}) }, headers);
}

export async function endStream(streamSessionId?: string) {
  const headers: Record<string, string> = {};
  if (streamSessionId) headers['x-stream-session'] = streamSessionId;
  await request('/app/stream/encerrar', { method: 'POST', body: JSON.stringify({}) }, headers);
}
