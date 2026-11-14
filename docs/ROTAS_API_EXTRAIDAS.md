# GoldDramas — Mapa de rotas da API (extraído do APK)

**Pacote:** `com.dsstv.dramaplatforma` · **nome interno:** Drama Platform / "Dramalhão" · **versão:** 1.0.0 (versionCode do APK: 1.0.0)
**Arquitetura:** Flutter (AOT) — o código de rede está compilado em `lib/arm64-v8a/libapp.so`, não em Java/Kotlin.
**Config de revenda:** `assets/flutter_assets/assets/reseller_config.json` → `{ "slug": "luiz-moraes" }`

---

## 1. Base

```
BASE (produção):  https://api.dsstv.online/api/v1/
```

Todos os caminhos do app são montados sobre essa base, em dois grupos: `/auth/app/*` (sem token) e `/app/*` (exige `Authorization: Bearer <JWT>`).

### Headers que o app envia

| Header | Valor | Quando |
|---|---|---|
| `Content-Type` | `application/json` | POST |
| `Accept` | `application/json` | sempre |
| `Authorization` | `Bearer <jwt>` | rotas `/app/*` |
| `X-Video-Formato` | `hls` / `mp4` | negociar formato do stream |
| `x-stream-session` | `streamSessionId` | heartbeat / encerramento da sessão de vídeo |

O token é um JWT HS256 com payload `{ id, papel: "clientes", iat, exp }` — validade de ~90 dias.

### Envelope de resposta

```json
{ "sucesso": true, "dados": <objeto|array>, "paginacao": { "total": 16749, "pagina": 2, "totalPaginas": 3350 } }
{ "sucesso": false, "mensagem": "Token não fornecido." }
```

`paginacao` só aparece nas rotas de listagem. Erros são sempre `{sucesso, mensagem}` com HTTP 400/401/404/500.

---

## 2. Autenticação — `/auth/app/*` (públicas)

| Método | Rota | Corpo | Retorno |
|---|---|---|---|
| POST | `/auth/app/visitante` | `{"deviceId": "<id>"}` | `{token, visitante: true, cliente:{id, nome, planoTipo, ePremium, origemTipo}}` |
| POST | `/auth/app/login` | `{"email", "senha"}` | `{token, cliente:{...}}` |
| POST | `/auth/app/registrar` | `{"email", "senha", "nome"}` | `{token, cliente:{...}}` |

Observações reais do servidor:

- `visitante` **só aceita `deviceId`**. Campos extras (`plataforma`, `versaoApp`…) devolvem `400 — Campos nao permitidos: ...`. O e-mail do visitante é gerado no padrão `guest_<deviceId>@guest.dsstv`.
- `login`/`registrar` validam primeiro `email` + `senha` e só depois os demais campos.

---

## 3. Conteúdo — `/app/*` (exigem Bearer)

### 3.1 Configuração e catálogo

| Método | Rota | Query | Para que serve |
|---|---|---|---|
| GET | `/app/config` | — | Branding/versão: `nomeApp, logoUrl, corPrimaria, descricao, emailSuporte, whatsappSuporte, bannerUrl, rodape, telegramOficial, versaoBaseMobile, versaoBaseTvbox` |
| GET | `/app/planos` | — | Planos de assinatura: `_id, nome, descricao, duracaoDias, precoCentavos, moeda, periodo, tipo, pacotesPermitidos[], gatewayPlanoIds{}, ativo, destaque, ordem` |
| GET | `/app/categorias` | — | Gêneros/tags: `_id, nome, slug, tipo ("tag"), icone, cor, destaque, ordem` |
| GET | `/app/perfil` | — | Usuário logado: `id, email, nome, expiresAt, pacotesPermitidos[], planoTipo` |

### 3.2 Listagem de doramas — **é aqui que o conteúdo está**

```
GET /app/dramas?pagina=1&limite=30
```

| Query | Tipo | Efeito |
|---|---|---|
| `pagina` | int | página (1-based) |
| `limite` | int | itens por página (o app usa 30) |
| `busca` | string | busca por título |
| `categoria` | slug | filtra por tag/gênero (ex.: `vinganca`) |
| `tipo` | string | ex.: `shortDrama`, `doramaTradicional`, `filme` |
| `ordenar` | string | ex.: `recentes` |

**A listagem já devolve o conteúdo inteiro aninhado** — cada item traz `temporadas[].episodios[]`. Não existe rota separada de episódios: quem precisa dos episódios usa o objeto `temporadas` da listagem ou do detalhe.

```
GET /app/dramas/{_id}
```
Detalhe por **ObjectId**. Buscar pelo `slug` (`/app/dramas/a-ascensao-do-casal-mafia`) devolve `500 — Erro ao carregar conteúdo`, o backend não resolve slug nessa rota.

### 3.3 Esquema do dorama (chaves reais)

```
_id, titulo, tituloOriginal, slug, tmdbId, tipo, generos[], tags[], pacote, secoes[],
sinopse, idioma, idiomaOriginal, legendas[], pais, anoLancamento, classificacaoIndicativa,
duracao, elenco[], diretores[], produtoras[], notaTmdb,
capaPrincipal, capaVertical, thumbnail, capaChave, capaStorageProvider, trailer,
urlFilmeStorageProvider, urlFilmeMascarada,
publicado, destaque, novo, emBreve, ordem, gratisTotalB2C, gratisTotalB2B, legendado,
idiomaTagManual, totalVisualizacoes, totalEpisodios, avaliacao, totalAvaliacoes,
temporadas[], createdAt, updatedAt, __v, tagIdioma, gratis
```

**Temporada:** `numero, titulo, episodios[], _id`

**Episódio:** `numero, titulo, descricao, duracaoSegundos, thumbnail, storageProvider, urlMascarada, visualizacoes, publicado, ordem, gratis, _id, createdAt, updatedAt`

> O campo `urlMascarada` vem **vazio** na listagem/detalhe de propósito: o link de vídeo só é entregue pelas rotas de stream abaixo. O `storageProvider` indica o back-end de armazenamento (`b2`, `b2minidramas`), e as capas vêm de um host separado (`dramainfo.dssapp.xyz`).

### 3.4 Player — `/app/stream/*`

| Método | Rota | Corpo | Retorno |
|---|---|---|---|
| POST | `/app/stream/urls` | `{"dramaId": "<id>"}` | `{streamSessionId, episodios:[{numero, titulo, urlVideo}]}` |
| POST | `/app/stream/iniciar` | `{"dramaId", "temporadaNumero", "episodioNumero"}` | `{urlVideo}` (+ sessão) |
| POST | `/app/stream/heartbeat` | `{}` ou `{"streamSessionId"}` / header `x-stream-session` | `{"Sessão renovada."}` |
| POST | `/app/stream/encerrar` | idem | `{"Stream encerrado."}` |

Regras descobertas na prática:

- A validação do backend é **estrita**: qualquer campo não previsto derruba a chamada com `400 — Campos nao permitidos: <campo>`. Foi assim que descobri que o nome é `dramaId` (não `episodioId`, `id` ou `episodio`) e `temporadaNumero`/`episodioNumero` (não `temporada`/`episodio`).
- **Formato não vai no corpo** — vai no header `X-Video-Formato` (`hls`/`mp4`). Mandar `formato` no JSON dá 400.
- `urls` exige só `dramaId` e devolve a lista completa de episódios com `urlVideo`; `iniciar` exige drama + temporada + episódio e devolve um único `urlVideo`.
- Os vídeos são servidos por um CDN em `cdn2.dsstv.online/videos/<titulo-slugificado>/temporada-N/...` (mascarado aqui de propósito).

### 3.5 Rotas auxiliares

| Método | Rota | Corpo | Notas |
|---|---|---|---|
| POST | `/app/checkout/iniciar` | `{"planoId", "email"}` | inicia assinatura, retorna link do gateway |
| POST | `/app/solicitar-conteudo` | `{"titulo"}` (mín. 2 chars) | pedido de dorama que não está no catálogo |
| POST | `/app/seguranca/evento` | `{"ameaca": "<tipo>"}` | telemetria anti-clonagem/anti-root (chaves vistas no binário: `app_clonado`, `app_adulterado`, `modo_desenvolvedor`, `instalacao_fora_da_loja`, `http_proxy`) |

### 3.6 Rotas que existem no binário mas não no servidor

`GET /app/vitrine` e `POST /app/vitrine` devolvem `404 — Rota não encontrada`. A string `https://api.dsstv.online/api/v1/app/vitrine?pagina=1&limite=30` está no APK, mas o backend atual (v19) já não expõe essa rota — provavelmente foi substituída por `/app/dramas`.

---

## 4. Onde isso estava no APK

| Artefato | Conteúdo |
|---|---|
| `lib/arm64-v8a/libapp.so` | snapshot Dart AOT com todas as URLs, headers e chaves JSON em texto claro |
| `assets/flutter_assets/assets/reseller_config.json` | `{"slug": "luiz-moraes"}` — identifica a revenda |
| `AndroidManifest.xml` | `com.dsstv.dramaplatforma`, permissões de rede/instalação de APK |
| `lib/arm64-v8a/libts.so` (21 MB) | biblioteca nativa de terceiro (SDK de segurança/player), sem rotas de conteúdo |

Comando que resolve o problema em segundos:

```bash
unzip -o GoldDramas.apk -d x/
strings -n 6 x/lib/arm64-v8a/libapp.so | grep -Eo 'https?://[^" ]*' | sort -u
```
