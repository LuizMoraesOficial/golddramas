#!/usr/bin/env node
// Constrói data/dubbed-seed.json: índice de doramas dublados em português.
// Custo único: consulta as janelas paginadas do catálogo e o endpoint de busca
// com uma lista de palavras-chave, deduplica por `code` e grava só os dublados.
//
// Uso: node scripts/build-dubbed-index.mjs            # crawl completo (49 requisições)
//      node scripts/build-dubbed-index.mjs --dry-run  # mostra o plano e não chama a API
//      node scripts/build-dubbed-index.mjs --max-keywords=10
// O plano gratuito da APIShort tem 100 requisições/dia: rode apenas ocasionalmente.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestApiShort, ApiShortError, cacheStats } from '../apishort.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputFile = path.join(root, 'data', 'dubbed-seed.json');

// Seed de partida: páginas 1–2 e fontes auxiliares. As páginas 3–7 ficam para
// a rolagem progressiva em catálogo.js, evitando consumir chamadas no primeiro lote.
const CATALOG_WINDOWS = [
  { endpoint: 'new', query: { page: 1 } },
  { endpoint: 'new', query: { page: 2 } },
  { endpoint: 'popular', query: { page: 1 } },
  { endpoint: 'category/1', query: { page: 1 } },
];

// O endpoint de busca responde em português quando existe variante dublada:
// os itens vêm prefixados com [Dublado]. Cada termo custa 1 requisição.
const KEYWORDS = [
  'dublado', 'esposa', 'bilionário', 'ceo', 'amor', 'vingança', 'casamento', 'filho',
  'mãe', 'rei', 'princesa', 'máfia', 'contrato', 'herdeiro', 'segredo', 'divórcio',
  'rainha', 'deus', 'médico', 'guerra', 'família', 'verdade', 'vida', 'amante',
  'noiva', 'irmão', 'destino', 'poder', 'trono', 'escândalo', 'herança', 'obsessão',
  'imperatriz', 'gêmeos', 'presidente', 'príncipe', 'coração', 'falso', 'pobre',
  'herdeira', 'médica', 'mulher', 'vendida', 'grávida', 'encontro',
];

const DUB_MARKER = /^\s*\[(?:dublado|dublada)\]/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = (payload) => (Array.isArray(payload?.data) ? payload.data : []);
const usageBefore = cacheStats();

const index = new Map();
const tagCount = new Map();
let requests = 0;
let failures = 0;

function ingest(list, origin) {
  let added = 0;
  for (const item of list) {
    if (!DUB_MARKER.test(String(item?.name ?? ''))) continue;
    const key = String(item.code ?? item.id ?? '').trim();
    if (!key) continue;
    if (!index.has(key)) {
      index.set(key, {
        id: String(item.id),
        code: key,
        name: String(item.name).replace(DUB_MARKER, '').trim(),
        summary: String(item.summary ?? '').trim(),
        episodes: Number(item.episodes ?? item.totalEpisodes ?? 0) || undefined,
        views: Number(item.views ?? 0) || undefined,
        favorites: Number(item.favorites ?? 0) || undefined,
        cover: String(item.cover ?? item.vertical_cover ?? item.poster ?? item.image ?? '').split('?')[0] || undefined,
        tagline: String(item.tagline ?? '').trim() || undefined,
        tags: Array.isArray(item.tags)
          ? item.tags.map((t) => (typeof t === 'string' ? t : String(t?.name ?? '').trim())).filter(Boolean)
          : undefined,
        origins: [origin],
      });
      added += 1;
      for (const tag of item.tags ?? []) {
        const label = typeof tag === 'string' ? tag : String(tag?.name ?? '').trim();
        if (label) tagCount.set(label, (tagCount.get(label) ?? 0) + 1);
      }
    } else {
      const entry = index.get(key);
      if (!entry.origins.includes(origin)) entry.origins.push(origin);
      entry.episodes ??= Number(item.episodes ?? item.totalEpisodes ?? 0) || undefined;
      entry.views = Math.max(entry.views ?? 0, Number(item.views ?? 0) || 0) || undefined;
      entry.favorites = Math.max(entry.favorites ?? 0, Number(item.favorites ?? 0) || 0) || undefined;
      if (!entry.summary && item.summary) entry.summary = String(item.summary).trim();
      if (!entry.cover && (item.cover || item.vertical_cover || item.poster || item.image)) {
        entry.cover = String(item.cover ?? item.vertical_cover ?? item.poster ?? item.image).split('?')[0] || undefined;
      }
      if ((!entry.tags || !entry.tags.length) && Array.isArray(item.tags)) {
        entry.tags = item.tags.map((t) => (typeof t === 'string' ? t : String(t?.name ?? '').trim())).filter(Boolean);
      }
    }
  }
  return added;
}

async function pull(endpoint, query, origin) {
  try {
    const payload = await requestApiShort(endpoint, { lang: 'pt', ...query });
    requests += 1;
    return ingest(rows(payload), origin);
  } catch (error) {
    requests += 1;
    failures += 1;
    const label = error instanceof ApiShortError ? `${error.status} ${error.message}` : String(error?.message ?? error);
    console.log(`  falha em ${endpoint} ${JSON.stringify(query)}: ${label.slice(0, 120)}`);
    return 0;
  }
}

const dryRun = process.argv.includes('--dry-run');
const maxKeywordsArg = process.argv.find((arg) => arg.startsWith('--max-keywords='));
const maxKeywords = maxKeywordsArg ? Number(maxKeywordsArg.split('=')[1]) : KEYWORDS.length;
const keywords = KEYWORDS.slice(0, Math.max(0, Number.isFinite(maxKeywords) ? maxKeywords : KEYWORDS.length));
const planned = CATALOG_WINDOWS.length + keywords.length;

if (dryRun) {
  console.log(`Plano do índice: ${CATALOG_WINDOWS.length} janelas + ${keywords.length} palavras-chave = ${planned} requisições`);
  console.log(`  janelas: ${CATALOG_WINDOWS.map((win) => `${win.endpoint}?page=${win.query.page}`).join(', ')}`);
  console.log(`  palavras-chave: ${keywords.join(', ')}`);
  console.log(`  saída: data/dubbed-seed.json`);
  process.exit(0);
}

console.log(`Janelas do catálogo (${planned} requisições previstas):`);
for (const win of CATALOG_WINDOWS) {
  const added = await pull(win.endpoint, win.query, win.endpoint);
  console.log(`  ${win.endpoint} page=${win.query.page}: +${added} dublados (total ${index.size})`);
  await delay(500);
}

console.log('Enumeração por palavra-chave (search):');
for (const keyword of keywords) {
  const added = await pull('search', { q: keyword }, `search:${keyword}`);
  console.log(`  ${keyword}: +${added} dublados (total ${index.size})`);
  await delay(450);
}

const items = [...index.values()].sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || String(b.id).localeCompare(String(a.id)));
const tags = [...tagCount.entries()]
  .filter(([, count]) => count >= 3)
  .sort((a, b) => b[1] - a[1])
  .map(([nome, count]) => ({ nome, count }));

const seed = { geradoEm: new Date().toISOString(), provedor: 'shortmax', lang: 'pt', total: items.length, tags, items };
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(seed, null, 1)}\n`);
const usageAfter = cacheStats();
console.log(`\nÍndice gravado: ${items.length} títulos dublados | ${tags.length} tags | ${requests} consultas | ${failures} falhas`);
console.log(`Chamadas upstream nesta execução: ${usageAfter.upstreamCalls - usageBefore.upstreamCalls}; acertos de cache: ${usageAfter.cacheHits - usageBefore.cacheHits}`);
console.log(`Arquivo: ${path.relative(root, outputFile)}`);
