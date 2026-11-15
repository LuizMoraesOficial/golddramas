# Integração do catálogo

## Segredo e variáveis de ambiente

O backend lê `APISHORT_API_KEY` de `process.env`. Localmente, `apishort.js` carrega `.env`; o `.gitignore` exclui esse arquivo e permite somente `.env.example`, que não contém segredo. Não existe campo de chave, endpoint de importação ou credencial no frontend, e as mensagens de erro da interface são genéricas. No Render, cadastre a variável nas configurações Environment do serviço; não a coloque no Git, no bundle nem em variável `VITE_*`. Consulte [RENDER_DEPLOY.md](RENDER_DEPLOY.md).

O `.env` local foi atualizado com a nova chave recebida pelo campo privado e o backend foi reiniciado. A chave anterior havia atingido o limite e retornava HTTP 429; a nova chave respondeu HTTP 200. O servidor mantém cache em memória por dois minutos para reduzir chamadas repetidas.

## Por que antes eram exibidos só 28 títulos

A versão anterior consultava apenas a primeira página de `popular`: ela retornava 117 registros, dos quais 28 tinham a marca `[Dublado]`; havia IDs repetidos e restavam 25 títulos únicos. A lista “Todos” agora combina e deduplica `popular` página 1, `new` páginas 1–2 e `category/1` página 1, mantendo somente itens explicitamente marcados como dublados em português. Na amostra ao vivo consultada antes do limite de cota, a união resultou em **68 IDs únicos**. “Novidades” também inclui as duas páginas úteis. A página 3 não trouxe IDs novos.

Os 68 são o total encontrado nessas rotas/páginas testadas, não uma contagem garantida de toda a biblioteca. A API não documenta um índice completo de categorias ou paginação confiável; não foram inventados novos IDs de categoria. As respostas de catálogo são cacheadas no servidor por dois minutos e no adaptador enquanto a página fica aberta.

## Idioma e dublagem

As consultas usam `lang=pt`, que o fornecedor lista como “Portuguese”, sem código regional `pt-BR`. O prefixo `[Dublado]` é removido do título, mas itens sem indicação explícita são ocultados. Como a API não distingue português brasileiro do europeu nem informa idioma regional da faixa no manifesto HLS, o filtro é conservador, mas não certifica tecnicamente o sotaque brasileiro de cada título.

## Detalhes e reprodução

`GET /detail/{id}` respondeu HTTP 404 para os IDs testados; o fluxo usa `GET /alleps/{id}?lang=pt`, que retorna metadados, episódios e URLs HLS assinadas. Uma resposta de amostra tinha 35 episódios e informava expiração do link em 8 horas. O player seleciona 720p e mantém fallbacks.

O CDN `akamai-static.shorttv.live` respondeu HTTP 200 para o manifesto `.m3u8`, mas sem CORS. O relay `/media/hls` só aceita HTTPS do host oficial observado no caminho `/hls/`, busca manifestos/segmentos no servidor e reescreve as URIs para mesma origem. O `hls.js` é carregado sob demanda nos navegadores sem HLS nativo.

## Testes realizados

| Teste | Resultado |
|---|---|
| Rotas catalogadas e união ao vivo | `popular`, `new`, `category/1`; 68 IDs únicos com marca explícita de dublagem |
| Episódio de amostra | 35 episódios e URLs HLS |
| Manifesto/segmento via relay | HTTP 200 e HTTP 206; segmento MPEG-TS recebido |
| Player no Preview | Episódio 1 reproduzido; legenda em português visível |
| Relay com host externo | Rejeitado com HTTP 400 |
| `.env` e header de autenticação | Parser testado em pasta temporária com valor fictício; a chave real não foi impressa |
| Nova chave local | `popular` retornou HTTP 200 e 117 registros; a função do catálogo retornou 68 títulos em “Todos” e 45 em “Novidades” |
| Interface do Preview | Mostra 68 títulos e não mostra a caixa de chave nem nome do fornecedor |
| Sem variável | HTTP 503 genérico; rota de importação via site removida (HTTP 404) |
| Bundle final | Sem nome do fornecedor, formulário nem `APISHORT_API_KEY` |
| TypeScript/build | Aprovados após as alterações atuais |

A referência pública lista `languages`, `popular`, `new`, `hot`, `category/1`, `search`, `detail/{id}` e `alleps/{id}`. Permanecem pendentes índice completo de categorias, parâmetro remoto de busca, esquema de paginação e identificação regional `pt-BR`.

Fontes: [Guia APIShort](https://apishort.com/guide/) e [referência ShortMax](https://apishort.com/platform/shortmax/).
