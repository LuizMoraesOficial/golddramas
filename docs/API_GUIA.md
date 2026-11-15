# Guia da API — GoldDramas / Drama Reels

Este projeto usa **APIShort / ShortMax** como fornecedor de dados, por meio de um backend Express same-origin. O browser nunca recebe a chave de acesso. A descrição empírica de endpoints, limitações e cota está em [APISHORT_INTEGRACAO.md](APISHORT_INTEGRACAO.md).

## Arquitetura

- Frontend: React 18 + Vite + TypeScript; chamadas somente para `/api/...` no próprio domínio.
- Backend: Express em `server.js`; chave `APISHORT_API_KEY` exclusivamente no servidor, enviada ao fornecedor em `X-API-Key`.
- Catálogo: índice deduplicado e filtrado para títulos com marcador de dublagem em português; semente versionada em `data/dubbed-seed.json`.
- Reprodução: `alleps/{id}` fornece episódios e URLs HLS temporárias; `/media/hls` faz relay restrito aos hosts oficiais de mídia.

## Rotas do app

### `GET /api/catalog`

Parâmetros aceitos: `page` (1-based), `limit` (máximo 60), `q`, `sort` (`destaque`, `recentes`, `vistos`, `episodios`) e `tag` (slug de gênero). Sem `q`, devolve uma página do índice local/seed. Com `q`, consulta `search?lang=pt&q=` na API, filtra resultados dublados e complementa com o acervo local.

Exemplos:

```bash
curl 'http://localhost:3000/api/catalog?page=1&limit=24&sort=destaque'
curl 'http://localhost:3000/api/catalog?q=pulseira&page=1&limit=24'
curl 'http://localhost:3000/api/catalog?tag=casa-nobre&page=1&limit=24'
```

Resposta contém `dramas[]`, `pagination {total,pagina,totalPaginas,mais}`, `catalog` e `busca {termo,origem,remotos,locais}`. `busca.origem` distingue API remota, cache/acervo, cota esgotada e indisponibilidade. A pesquisa funciona independentemente da página anteriormente carregada.

### `GET /api/catalog/meta`

Retorna total de itens, tags utilizáveis, timestamp de construção, avisos e `uso` (chamadas upstream, cache hits e erros). Serve para verificar a cota e a saúde do índice.

### `GET /api/catalog/detail/:id`

Carrega metadados e episódios via `alleps/{id}?lang=pt`. O identificador é a variante em português (`id`), não necessariamente o `code` global. Os links HLS do fornecedor expiram em aproximadamente 8 horas; não os persista como URLs permanentes. Erros do fornecedor (inclusive HTTP 429 por cota) devem ser mostrados ao usuário como indisponibilidade, não como ausência definitiva de vídeo.

### `GET /media/hls`

Relay same-origin de playlist/segmentos HLS, validando os hosts de mídia aprovados. Não usar para encaminhar URLs de hosts arbitrários.

### `POST /api/catalog/refresh`

Atualiza o índice em memória, somente quando `APISHORT_REFRESH_TOKEN` está configurado e enviado como `Authorization: Bearer ...`. O refresh faz chamadas pagas/limitadas: não use rotineiramente no plano gratuito.

## API upstream: limitações medidas

- Base URL: `https://apishort.com/v1/shortmax/api/v1/`; header `X-API-Key`.
- `new?lang=pt&page=n` é a rota de janela com paginação útil; a partir de `page=20` ocorre HTTP 500.
- `popular`, `hot`, `category/{id}` e `search` ignoram seus parâmetros de página; `hot` repete `popular`; `category/{id}` retorna sempre os mesmos itens.
- `search` considera o termo globalmente e retorna até cerca de 26 itens, sem paginação. O app complementa com o índice local.
- `alleps/{id}` retorna array `episodes[]`; cada elemento pode conter `video.video_720`, `video.video_480` e `video.video_1080`.
- `id`/`code` variam por endpoint; deduplicar por ambos evita duplicatas.

O plano free observado permite 100 requisições/dia. Cache em memória/disco, TTLs longos, dedupe concorrente e seed reduzem o consumo; o cache em disco do Render pode ser efêmero entre deploys, portanto a semente versionada é importante. Não prometa que todo o acervo do fornecedor é enumerável: o fornecedor não expõe uma listagem paginável completa.

## Configuração e execução

Localmente, configure `APISHORT_API_KEY` em `.env` (arquivo ignorado no Git). No Render, cadastre-a no **Environment** do serviço — não use prefixo `VITE_`. Comandos:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm start
```

Para diagnóstico:

```bash
curl -s http://localhost:3000/api/catalog/meta
bash scripts/smoke-test.sh
```

A busca, detalhe, mídia e chave são todas mediadas pelo backend; não copie chave ou URL HLS assinada para logs, bundles ou repositório.
