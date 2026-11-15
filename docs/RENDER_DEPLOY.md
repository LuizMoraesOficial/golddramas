# Deploy no Render (configuração para o titular)

## Chave da API

No serviço Web do Render, abra **Environment** e defina a variável:

| Nome | Valor |
|---|---|
| `APISHORT_API_KEY` | a chave API atual do titular |

A chave foi atualizada localmente no ambiente de desenvolvimento. Isso não altera automaticamente a configuração do Render: copie a chave atual para a variável do serviço no painel do Render e não a envie por Git, `.env.example`, `vite.config.ts`, frontend ou uma variável `VITE_*`. O segredo é usado apenas pelo Express no header `X-API-Key`.

Opcional: `APISHORT_BASE_URL` (padrão `https://apishort.com`), `APISHORT_PROVIDER` (ShortMax) e `CATALOG_INDEX_TTL_MINUTES` (padrão 360 min). O Render fornece `PORT` automaticamente.

## Comandos do serviço

- **Build Command:** `pnpm install --frozen-lockfile && pnpm build`
- **Start Command:** `pnpm start`
- **Runtime:** Node.js

O servidor Express serve o frontend compilado e as rotas `/api/catalog*` e `/media/hls` no mesmo domínio. Deploy/redeploy é uma ação do titular; nenhum deploy foi executado nesta tarefa.

## Cota e cache

O plano gratuito observado da APIShort tem limite de 100 requisições por dia. A cota pertence à chave/API, portanto chamadas feitas pelo sandbox e pelo Render podem compartilhar o mesmo limite. O backend mantém cache em memória e `.cache/` em disco, mas o filesystem do Render pode ser efêmero e não necessariamente sobrevive ao deploy/reinício. `data/dubbed-seed.json` permite iniciar o catálogo sem chamadas upstream; o primeiro refresh/rebuild e títulos ainda não cacheados podem consumir chamadas. Consulte `GET /api/catalog/meta` para `uso.upstreamCalls`, `cacheHits` e erros. Evite disparar refresh manual.

## Execução local e segredo

Crie `.env` localmente com `APISHORT_API_KEY`, arquivo ignorado pelo Git. O servidor carrega o `.env` na inicialização. Confirme `git status --short` antes de enviar alterações; nunca force a inclusão do `.env`. A chave configurada localmente e a do Render são independentes.

## Smoke test pós-deploy

```bash
curl -fsS https://SEU-SERVICO.onrender.com/health
curl -fsS https://SEU-SERVICO.onrender.com/api/catalog/meta
```

Os comandos acima consultam apenas o serviço do app; para confirmar busca remota, pesquise um termo conhecido na interface e observe o texto de origem. Verifique no log do Render que nenhuma chave aparece. Não faça refresh amplo sem necessidade.
