# Plano — Drama Reels (protótipo temporário)

## Escopo

Construir um protótipo web rápido para testar o catálogo GoldDramas usando as rotas recuperadas do APK. O protótipo terá autenticação automática como visitante, catálogo contínuo de capas, página de detalhe e um player vertical em tela cheia com navegação por gesto para cima/baixo entre episódios. Não haverá cadastro, cobrança, persistência própria ou acabamento de produto definitivo.

## Implementação

- **Frontend:** React + TypeScript + Vite, com estado local e CSS responsivo.
- **Backend leve:** Node/Express para servir o build e atuar como proxy same-origin para `https://api.dsstv.online/api/v1`, evitando CORS no navegador e mantendo a base da API fora do código de UI.
- **Sessão:** ao abrir o site, gerar um `deviceId` persistente em `localStorage`, chamar `POST /api/auth/app/visitante`, e guardar o JWT apenas no armazenamento local da sessão de teste.
- **Catálogo:** `GET /api/app/dramas?pagina=&limite=12&tipo=shortDrama`, com carregamento inicial leve e paginação ao aproximar do fim; mostrar capas de mini séries em uma lista vertical sequencial.
- **Detalhe:** ao clicar, carregar `GET /api/app/dramas/{_id}` e exibir título, sinopse, metadados e lista de temporadas/episódios.
- **Streaming:** `POST /api/app/stream/iniciar` com `dramaId`, `temporadaNumero` e `episodioNumero`; enviar `X-Video-Formato: hls`, guardar `streamSessionId` quando retornado e fazer heartbeat periódico; encerrar ao sair do player.
- **Player Reels:** overlay em viewport móvel, `video` com `playsInline`, seleção de episódio, wheel e touch vertical para avançar/voltar, além de botão fechar, play/pause, mudo e indicador do episódio.
- **Rotas declaradas:** `/` e `/drama/:id` para o manifest de rotas; o player será um modal da tela de detalhe para manter o protótipo simples.

## Direção visual — Cinema Noturno Neon

- **Movimento:** interface cinematográfica escura, com capas dominantes e acentos magenta elétricos para streaming móvel e descoberta rápida.
- **Princípios:** foco total no conteúdo; contraste alto; camadas translúcidas discretas; feedback imediato em gestos e carregamentos.
- **Cores:** fundo quase preto roxo (`#0b0710`), superfícies ameixa (`#17101f`), texto lavanda claro e magenta elétrico (`#e6007e`) para ações/estado ativo.
- **Layout:** catálogo em coluna de cards horizontais largos, com capa vertical e texto em overlay; detalhe em composição editorial; player ocupa toda a viewport.
- **Assinaturas:** brilho magenta sob a marca, chips de gênero em cápsula e uma linha de progresso/episódio no topo do player.
- **Interação:** cliques abrem conteúdo; deslizar verticalmente muda de episódio; feedback mostra “Próximo episódio”/“Episódio anterior”; os controles ficam sobrepostos e desaparecem suavemente.
- **Animação:** entrada dos cards com fade/translate curto; transições de rota e player sem efeitos pesados; respeitar `prefers-reduced-motion`.
- **Tipografia:** Sora para títulos e interface, com pesos fortes para títulos e labels compactas; corpo em Sora regular com boa legibilidade em fundo escuro.
- **Essência:** um laboratório visual para testar descoberta e reprodução vertical de doramas, rápido e sem compromisso de produto final. Personalidade: cinematográfica, ágil, imersiva.
- **Voz:** curta e direta. Exemplos: “Escolha uma história.” / “Deslize para continuar.”
- **Marca:** wordmark “Drama Reels” com “Reels” em magenta e um pequeno marcador vertical sugerindo swipe.
- **Cor proprietária:** magenta elétrico `#E6007E`.

## Estrutura

```text
index.html
server.js
vite.config.ts
package.json
public/manus-routes.json
src/
  main.tsx          # entrada React
  App.tsx           # catálogo, detalhe e modal player
  api.ts            # sessão visitante, catálogo e streaming
  types.ts          # tipos de domínio
  styles.css        # sistema visual e responsividade
```
