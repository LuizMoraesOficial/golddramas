# Plano — GoldDramas / Drama Reels

## Escopo concluído

Corrigir a descoberta de títulos dublados, a rolagem infinita, a pesquisa em toda a nuvem e a resiliência da integração APIShort / ShortMax. O projeto não foi publicado nem conectado ao Render nesta tarefa.

## Implementação

- **Catálogo:** índice combinado, deduplicado por aliases `id` e `code`, com seed versionada. O build validado apresenta 143 títulos dublados únicos, contra cerca de 68 da implementação anterior.
- **Rolagem:** `/api/catalog?page&limit` pagina o índice; o frontend carrega 24 títulos por lote usando `IntersectionObserver`, refs de concorrência e botão acessível de fallback.
- **Pesquisa remota:** `q` segue até `search?lang=pt&q=`, independentemente da página aberta; resultados são filtrados para dublagem e complementados com o índice local. A UI informa resultados remotos e locais. Testado com `pulseira`: 4 títulos, 2 da API e 2 do acervo registrado.
- **Filtros:** abas de ordenação e nove tags reais filtram os itens disponíveis no índice.
- **Detalhe/player:** `alleps/{id}` produz episódios e HLS; links temporários passam pelo relay restrito a domínios autorizados. Detalhe testado com 63 episódios.
- **Resiliência:** cache memória + disco, dedupe in-flight e seed favorecem o plano gratuito (100 chamadas/dia). UI apresenta indisponibilidade/cota em vez de alegar que o vídeo não existe.
- **Segredo:** chave somente no backend; local em `.env` ignorado pelo Git e produção por variável do Render. Nenhum segredo no bundle.

## Limites verificados do fornecedor

A API não oferece uma listagem completa paginável: apenas `new` tem janelas úteis; `popular`, `hot`, `category/{id}` e `search` ignoram paginação. `hot` repete `popular`; `category/{id}` repete os mesmos itens. Portanto, 143 é a cobertura observada do índice, não promessa de completude absoluta do catálogo ShortMax. Busca remota alcança resultados fora das páginas já carregadas, limitada ao retorno de busca do provedor (até ~26 por termo).

## Configuração Render

- Build: `pnpm install --frozen-lockfile && pnpm build`
- Start: `pnpm start`
- Environment obrigatório: `APISHORT_API_KEY` (a chave atual deve ser copiada manualmente pelo titular para o Render; `.env` local não é enviado).
- Nenhum deploy foi feito nesta tarefa.

Consulte `docs/APISHORT_INTEGRACAO.md`, `docs/API_GUIA.md` e `docs/RENDER_DEPLOY.md` para detalhes.
