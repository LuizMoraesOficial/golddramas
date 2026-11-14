# Guia da API do Drama Reels / GoldDramas

Este documento descreve como o protótipo faz autenticação, consulta o catálogo, pesquisa títulos, abre os detalhes, inicia episódios e mantém uma sessão de reprodução. Os exemplos usam `curl`, mas os mesmos corpos JSON podem ser usados em JavaScript, Dart, Kotlin, Swift ou outra linguagem HTTP.

> Use esta documentação apenas com autorização sobre a API e o conteúdo. O guia não inclui tokens, senhas ou credenciais permanentes.

## 1. URL base e headers

A API de produção usada pelo aplicativo é:

```text
https://api.dsstv.online/api/v1
```

O site deste projeto usa um proxy same-origin. No navegador, as mesmas rotas aparecem com o prefixo `/api`; por exemplo, `/api/app/dramas` é encaminhado para `https://api.dsstv.online/api/v1/app/dramas`.

Para respostas JSON, envie:

```http
Accept: application/json
Content-Type: application/json
```

As rotas protegidas também exigem:

```http
Authorization: Bearer SEU_TOKEN
```

As rotas de stream usam ainda:

```http
X-Video-Formato: mp4
```

O formato `hls` pode ser solicitado quando o cliente tiver suporte a HLS. O protótipo usa `mp4`.

## 2. Autenticação de visitante

A autenticação deve ser feita antes de qualquer rota `/app/*`.

### Requisição

```bash
curl -X POST \
  'https://api.dsstv.online/api/v1/auth/app/visitante' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"meu-dispositivo-web-001"}'
```

O corpo deve conter somente `deviceId`. Gere um identificador persistente por instalação/dispositivo e reutilize-o durante a sessão. Não coloque senha, e-mail ou campos adicionais nessa chamada.

### Resposta esperada

```json
{
  "sucesso": true,
  "dados": {
    "token": "JWT_RECEBIDO",
    "visitante": true
  }
}
```

Guarde o valor de `dados.token` somente no armazenamento seguro da aplicação. Para todas as requisições protegidas, use `Authorization: Bearer <token>`.

Se a autenticação retornar `401`, `403` ou `sucesso: false`, descarte o token, gere um novo `deviceId` somente quando necessário e repita a autenticação. Nunca exponha o token na interface ou em logs públicos.

## 3. Carregar o catálogo completo

A listagem é paginada. O aplicativo deve começar pela página 1 e continuar enquanto `pagina < totalPaginas`. O protótipo usa 30 itens por página.

```bash
curl -G \
  'https://api.dsstv.online/api/v1/app/dramas' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  --data-urlencode 'pagina=1' \
  --data-urlencode 'limite=30'
```

A resposta possui o formato:

```json
{
  "sucesso": true,
  "dados": [
    {
      "_id": "ID_DO_DRAMA",
      "titulo": "Título do dorama",
      "sinopse": "Resumo",
      "capaPrincipal": "https://...",
      "capaVertical": "https://...",
      "tipo": "shortDrama",
      "temporadas": [
        {
          "numero": 1,
          "titulo": "Temporada 1",
          "episodios": [
            {
              "numero": 1,
              "titulo": "Episódio 1",
              "duracaoSegundos": 146
            }
          ]
        }
      ]
    }
  ],
  "paginacao": {
    "total": 16749,
    "pagina": 1,
    "totalPaginas": 559
  }
}
```

Acumule `dados` de cada página. Não use um limite muito baixo nem tente carregar milhares de páginas simultaneamente; faça a paginação sob demanda, por rolagem infinita ou botão “carregar mais”.

### Parâmetros opcionais do catálogo

```text
busca=termo       pesquisa por título
categoria=slug    filtra por gênero/tag
 tipo=shortDrama  filtra pelo tipo; omita para consultar todos os tipos
ordenar=recentes  ordenação disponível no backend
```

Exemplo de pesquisa:

```bash
curl -G \
  'https://api.dsstv.online/api/v1/app/dramas' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  --data-urlencode 'pagina=1' \
  --data-urlencode 'limite=30' \
  --data-urlencode 'busca=ascensão'
```

Ao iniciar uma nova pesquisa, descarte a lista antiga, volte para `pagina=1` e continue usando `paginacao` para carregar os resultados seguintes.

## 4. Abrir os detalhes de um dorama

Use o `_id` retornado pelo catálogo. A rota aceita ObjectId; não use o `slug` no lugar do ID.

```bash
curl \
  'https://api.dsstv.online/api/v1/app/dramas/ID_DO_DRAMA' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN'
```

O detalhe retorna os metadados e as temporadas com seus episódios. Monte a lista de episódios com:

```text
 drama.temporadas[].episodios[]
```

Cada episódio deve ser identificado por sua temporada e pelo número do episódio. Não confunda o `_id` do drama com o número do episódio.

## 5. Iniciar a reprodução de um episódio

Quando o usuário tocar em “Assistir”, envie o ID do drama, o número da temporada e o número do episódio. O formato vai no header, não no JSON.

```bash
curl -X POST \
  'https://api.dsstv.online/api/v1/app/stream/iniciar' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'X-Video-Formato: mp4' \
  -d '{
    "dramaId":"ID_DO_DRAMA",
    "temporadaNumero":1,
    "episodioNumero":1
  }'
```

Resposta típica:

```json
{
  "sucesso": true,
  "dados": {
    "urlVideo": "https://cdn2.dsstv.online/videos/...mp4?...",
    "streamSessionId": "ID_DA_SESSAO",
    "expiresEm": "..."
  }
}
```

Use `dados.urlVideo` como `src` do elemento de vídeo. A URL pode ser temporária; não a salve como URL permanente. Se o navegador não suportar o codec entregue, trate o evento de erro do vídeo e use o fallback compatível do projeto.

## 6. Lista de URLs de episódios

Existe também uma rota que retorna os links de stream dos episódios do drama:

```bash
curl -X POST \
  'https://api.dsstv.online/api/v1/app/stream/urls' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'X-Video-Formato: mp4' \
  -d '{"dramaId":"ID_DO_DRAMA"}'
```

Use essa rota somente quando fizer sentido pré-carregar ou mapear os episódios. Para o player sob demanda, prefira `stream/iniciar`, pois ele entrega uma URL por vez e cria a sessão correspondente ao episódio atual.

## 7. Play, pause e troca de episódio

Não existe uma rota HTTP separada para “play” ou “pause”. Essas ações são locais no player do cliente:

```js
const video = document.querySelector('video');

await video.play();  // play
video.pause();       // pause
video.muted = true;  // silenciar
video.muted = false; // ativar áudio
```

Para trocar de episódio, encerre ou substitua a reprodução atual e chame novamente `stream/iniciar` com o novo `temporadaNumero` e `episodioNumero`. O player deste projeto faz isso ao deslizar para cima/baixo ou usar os botões de episódio.

O encerramento da sessão de stream deve ser feito quando o usuário fecha o player ou muda de contexto. Veja a seção 9.

## 8. Heartbeat durante a reprodução

Enquanto o vídeo estiver aberto, renove a sessão aproximadamente a cada 25 segundos. Envie o `streamSessionId` no header `x-stream-session`.

```bash
curl -X POST \
  'https://api.dsstv.online/api/v1/app/stream/heartbeat' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'x-stream-session: ID_DA_SESSAO' \
  -d '{}'
```

O heartbeat deve ser interrompido quando o player for fechado ou quando a sessão não estiver mais ativa.

## 9. Encerrar a sessão

Ao fechar o player, encerre a sessão de stream:

```bash
curl -X POST \
  'https://api.dsstv.online/api/v1/app/stream/encerrar' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'x-stream-session: ID_DA_SESSAO' \
  -d '{}'
```

Mesmo que a chamada de encerramento falhe por perda de rede, o cliente deve liberar o timer de heartbeat, remover o elemento de vídeo e limpar o estado local da sessão.

## 10. Fluxo completo recomendado

1. Gere ou recupere um `deviceId` persistente.
2. Faça `POST /auth/app/visitante` e guarde o JWT em armazenamento de sessão seguro.
3. Faça `GET /app/dramas?pagina=1&limite=30`.
4. Para rolagem, carregue as páginas seguintes até `pagina === totalPaginas`.
5. Para pesquisa, reinicie em `pagina=1` com `busca=...`.
6. Ao selecionar um título, faça `GET /app/dramas/{_id}`.
7. Ao selecionar um episódio, faça `POST /app/stream/iniciar`.
8. Coloque `dados.urlVideo` no elemento `<video>` e controle play/pause localmente.
9. Envie heartbeat a cada aproximadamente 25 segundos.
10. Ao fechar ou trocar de sessão, faça `POST /app/stream/encerrar` e pare o heartbeat.

## 11. Erros comuns

| Sintoma | Causa provável | Correção |
|---|---|---|
| `401` ou `403` em `/app/*` | Token ausente, expirado ou rejeitado | Refazer a autenticação visitante e repetir a chamada |
| `400 Campos nao permitidos` | Campo extra ou nome incorreto no JSON | Enviar somente os campos documentados |
| Catálogo vazio | Filtro `tipo` limitando os resultados | Omitir `tipo` para carregar todos os tipos |
| Busca não filtra | Parâmetro incorreto | Usar `busca`, com URL encoding |
| Stream sem vídeo | Sessão/token inválido ou episódio incorreto | Confirmar `dramaId`, temporada, episódio e header `X-Video-Formato` |
| Vídeo não decodifica | Codec não suportado pelo navegador | Usar o fallback de mídia do projeto ou um cliente com suporte ao codec |
| Player funciona e depois para | Sessão não renovada | Enviar `heartbeat` periodicamente |

## 12. Arquivos do projeto relacionados

- `src/api.ts`: autenticação, catálogo, detalhe e stream.
- `src/App.tsx`: fluxo de catálogo, pesquisa, player e controles locais de vídeo.
- `server.js`: proxy same-origin e fallback de mídia em produção.
- `vite.config.ts`: proxy do Preview e remoção de headers que a API rejeita.
- `public/manus-routes.json`: rotas de página do site.
