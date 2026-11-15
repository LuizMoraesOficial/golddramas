# Integração do catálogo (APIShort / ShortMax)

## Comportamento medido na API real (15/nov/2026, chave do titular)

| Rota | Parâmetros que funcionam | Parâmetros ignorados | Retorno |
|---|---|---|---|
| `new?lang=pt` | `page` | `pageSize` | 104–118 itens por página. `page=3` repete a maior parte de 1–2; `page=4` acrescenta ~1 título e `page=7` um bloco novo; 5–6 e 8–15 repetiram títulos nas sondagens. `page>=16` respondeu HTTP 500. |
| `popular?lang=pt` | — | `page`, `pageSize` | 117 itens (112 ids); `page=2` só embaralha a ordem. |
| `hot?lang=pt` | — | `page` | **idêntico** a `popular` — não é uma fonte nova de títulos. |
| `category/{n}?lang=pt` | — | `n`, `page`, `pageSize` | Sempre os mesmos 20 itens: `category/1`, `category/2` e `category/999` são iguais. A rota não pagina nem filtra. |
| `search?lang=pt&q=` | `q` | `page`, `pageSize` | Até 26 itens, **todos os idiomas misturados**; os dublados em português chegam com o prefixo `[Dublado]` em `name`. |
| `alleps/{id}?lang=pt` | — | — | metadados + `episodes[]` com `video.video_720/1080/480` assinados por 8 h (`expires_in` 28800). |
| `languages` | — | — | 19 idiomas. |

Identificadores:

- `code` é a identidade global do drama; `id` é a identidade da variante por idioma e é o valor que `alleps` espera.
- Nas janelas de catálogo `id != code`. Em `search`, `id == code` (a própria variante). Por isso o mesmo título entra duas vezes se a deduplicação usar só uma das chaves — o índice deduplica pelo conjunto `{id, code}`.
- Capas e vídeos usam `auth_key` assinado. O CDN **entrega a imagem sem o parâmetro** (HTTP 200, mesmo corpo), então as capas do índice são gravadas sem assinatura e não apodrecem. As URLs HLS continuam assinadas e passam pelo relay `/media/hls`.
- `summary` de itens vindos de `search` pode vir noutro idioma (encontrado um caso em alemão). O índice descarta sinopse sem função em português e a interface usa a frase padrão.

## Como a correção funciona

**Rolagem infinita.** `src/api.ts` não paginava nada: `listDramas()` buscava um conjunto fixo e devolvia uma única página. Agora o servidor monta um índice único, ordena por aba e devolve fatias reais. Depois dos 170 títulos da semente, cada solicitação consulta no máximo uma página ainda não percorrida (`new?page=8..15`), deduplica por aliases `{id, code}` e por título+capa exatamente iguais, e acrescenta somente dramas dublados inéditos. As páginas 1–7 já estão representadas na semente atual; respostas repetidas não criam cards. Se uma página não trouxer novidades, a rolagem automática pausa e uma mensagem acolhedora aparece, mas o botão continua disponível para avançar manualmente. Se chegarem novos títulos, a rolagem progressiva pode continuar. A página 16 não é tentada porque respondeu HTTP 500 nas sondagens. O provedor não divulga um total oficial de páginas.

**Busca na nuvem.** Antes a busca era `drama.titulo.includes(...)` sobre o que já estava na tela (o placeholder dizia "Pesquisar nos títulos carregados") e o proxy ainda descartava o parâmetro `q`, repassando só `lang` e `page`. Hoje `GET /api/catalog?q=` faz, na ordem:

1. `search?lang=pt&q=` na APIShort — alcança a biblioteca inteira, não a página em que o usuário está;
2. filtro que mantém apenas os itens com marcador de dublagem em português;
3. complemento do índice local, para o caso de a cota ter acabado ou a API ter saído do ar.

A resposta traz `{ termo, origem, remotos, locais }` e a interface diz de onde veio cada resultado. Não há promessa de "busca na nuvem" quando o que salvou foi o cache.

**Um efeito só.** Havia três `useEffect` disparando `loadCatalog(1, ...)`: boot, `searchQuery` e `activeCategory`. Agora um único efeito reage a `visitorReady`, `activeTab` e `searchQuery`, com as refs `pageRef`/`loadingRef`/`requestRef` evitando requisição dupla e resposta fora de ordem — relevante porque cada chamada desperdiçada custa cota.

## Economia de cota (plano free: 100 requisições/dia)

- `apishort.js` guarda cada resposta em memória **e** em `.cache/` com TTL por rota: catálogo 12 h, `search` 24 h, `alleps` 4 h (os links valem 8 h), `languages` 7 dias. Há deduplicação de chamadas simultâneas para a mesma chave.
- O índice é reconstruído a cada 6 h (`CATALOG_INDEX_TTL_MINUTES`), não a cada 30 min: 30 min custaria ~240 requisições/dia contra um limite de 100.
- `data/dubbed-seed.json` é versionado e serve de partida a frio: um deploy novo já sobe com os títulos registrados, gastando 0 requisições.
- `scripts/build-dubbed-index.mjs` refaz a semente (49 consultas: 4 janelas iniciais + 45 termos de busca) e `--dry-run` mostra o plano sem tocar na API. A execução atual reutilizou o cache: 0 chamadas upstream.
- `GET /api/catalog/meta` expõe `uso: { upstreamCalls, cacheHits, errors }`, além das páginas de catálogo ainda sob demanda. As sondagens de páginas e busca feitas nesta correção também usaram o cache quando possível.

## Cobertura atual do índice

**170 títulos dublados encontrados** no crawl atual, partindo de 149 no índice inicial e acrescentando 21 após consultar as páginas `new` 3–7. A semente atual contém 170 registros, todos com URL de capa. Na ordem realmente entregue, a faixa visual 96–146 tem 51 cards, 49 URLs de capa distintas e nenhuma capa ausente; dois pares da semente repetem título e capa com IDs diferentes. A busca consulta `search?lang=pt&q=` independentemente da página; foi ampliada com 13 termos que revelaram títulos novos. O fornecedor limita `search` a ~26 resultados por termo, mistura idiomas e não oferece rota de exportação integral: 170 é o total deduplicado por identificadores encontrado neste conjunto de páginas/termos, não promessa de que seja todo o acervo do provedor. Foram observadas respostas até `page=15`; isso é o maior número testado com resposta, não um total oficial. `page=16` respondeu HTTP 500.

## Reproduzir teste

```bash
pnpm build && PORT=3000 node server.js
bash scripts/smoke-test.sh              # paginação, ordenações, tags, busca, detalhe
curl -s localhost:3000/api/catalog/meta # total, tags e consumo de cota
```

## Pendências honestas

- O marcador `[Dublado]` não distingue português brasileiro de europeu; a API só expõe `pt`.
- Não há índice de categorias utilizável: `category/{n}` ignora `n`. As abas de gênero vêm dos `tags` presentes nos itens de `popular`/`category` (9 tags com 3+ títulos).
- O cache em `.cache/` é descartável: após um redeploy, a semente versionada permanece disponível; a instância busca quatro janelas-base e pode consultar, uma por solicitação, até oito páginas adicionais (`new?page=8..15`). As chamadas continuam sujeitas à cota gratuita de 100/dia.
