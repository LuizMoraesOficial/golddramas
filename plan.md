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


## Retomada de episódios e estados assistidos

Persistir no `localStorage`, por ID estável do dorama, a temporada/episódio selecionado mais recentemente, o segundo exato da reprodução e a lista dos episódios concluídos identificados por temporada + número. Ao abrir o detalhe, “Assistir agora” deve retomar o episódio salvo e buscar para a posição armazenada quando disponível; cair para o primeiro episódio reproduzível quando não houver estado salvo. O player atualiza a posição durante a reprodução e ao sair/ocultar a janela, e marca a conclusão no evento de término; os cards distinguem “continuar” de “assistido”. Sem alteração de API/backend.


## Extensão PWA e Picture-in-Picture (15/nov/2026)

O app será instalável como PWA, sem APK, com manifest próprio, ícones de marca, registro de service worker e botão de instalação na tela inicial. Em navegadores com `beforeinstallprompt`, o botão abre o fluxo nativo; em iPhone, ele apresenta o caminho manual de Safari/Compartilhar/Adicionar à Tela de Início. O cache offline fica restrito ao shell e assets; `/api/` e `/media/` não serão armazenados.

O player oferecerá uma ação explícita de janela flutuante para o usuário ativar PiP antes de alternar para outro app. A implementação usará a API padrão e a de apresentação WebKit quando disponíveis. PiP depende de gesto do usuário, navegador e sistema operacional; PWAs iOS instaladas têm uma limitação WebKit conhecida e a interface deve apresentar fallback em vez de prometer sobreposição em todos os iPhones.
