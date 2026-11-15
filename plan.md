# Plano — GoldDramas

## Escopo

Atualizar o projeto React/Vite existente, preservando sua identidade, navegação e responsividade. Consumir conteúdo real pela camada Express e usar a chave somente no backend por variável de ambiente. Não publicar a aplicação nesta tarefa.

## Implementação atual

- **Catálogo:** “Todos” une e deduplica `popular` página 1, `new` páginas 1 e 2 e `category/1` página 1. Itens sem marcador explícito de dublagem em português são descartados. A amostra ao vivo encontrou 68 títulos únicos; o fornecedor repetia IDs e conteúdo entre respostas.
- **Filtros:** “Novidades”, “Em alta” e “Categoria 1” usam os endpoints conhecidos. Busca continua local nos títulos já carregados; não inventa parâmetros de busca ou IDs de categoria.
- **Segredo:** `APISHORT_API_KEY` é lida por `process.env`; localmente `apishort.js` carrega `.env` ignorado pelo Git. Não há campo, endpoint de importação ou credencial no frontend. O Render injeta a variável pelo Environment do serviço.
- **Backend:** Express autentica pelo header `X-API-Key`, usa allowlist e timeout, retorna erros genéricos à interface e mantém cache de dois minutos para respostas de catálogo.
- **Detalhes e player:** `alleps/{id}` fornece episódios e URLs HLS. Um relay same-origin restrito ao host oficial de mídia reescreve manifestos/segmentos para permitir reprodução. HLS.js é carregado quando necessário.
- **Preview:** desenvolvimento em Vite na porta 3000, backend API local na 3001 e relay de mídia na 3002. O servidor Express de produção serve o build na porta `PORT`.

## Variáveis no Render

Obrigatória: `APISHORT_API_KEY`. O `.env` local nunca deve ser enviado ao Git. Comandos sugeridos: Build `pnpm install --frozen-lockfile && pnpm build`; Start `pnpm start`. Consulte [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md).

## Limitação de idioma

A API sinaliza `pt`, mas não fornece distinção `pt-BR`/pt-PT nem metadados regionais de áudio. O filtro usa `lang=pt` e marcação `[Dublado]`; a confirmação de variante regional depende do fornecedor.
