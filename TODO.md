# TODO — GoldDramas / Drama Reels

## Concluído

- [x] Preservar a aplicação React/Vite e manter a chave API exclusivamente no backend.
- [x] Ampliar o índice dublado de 68 para 143 títulos únicos usando janelas disponíveis, fontes de catálogo e seed versionada.
- [x] Implementar rolagem infinita, paginação real do índice e deduplicação estável.
- [x] Implementar busca remota independente da página aberta, filtro dublado PT e complemento do acervo local. Busca de `pulseira` validada com 4 resultados (2 API + 2 acervo).
- [x] Validar tags reais (ex.: Casa Nobre retorna 17 títulos), detalhe e player: título de teste carregou 63 episódios HLS.
- [x] Testar atualização da chave local recebida em privado: nova chave autenticou; detalhe antes bloqueado carregou 50 episódios. O teste consumiu 2 chamadas upstream após o reinício.
- [x] Corrigir o texto de detalhe para distinguir cota/API indisponível de um vídeo que realmente não foi fornecido.
- [x] Adicionar cache em memória/disco, seed de cold-start, telemetria de chamadas e dedupe de requisições simultâneas.
- [x] Atualizar este plano, o guia de API e as instruções de Render; conferir o segredo fora do controle de versão.
- [x] TypeScript e build de produção devem passar no teste final.

## Pendências do titular

- [ ] Atualizar `APISHORT_API_KEY` no **Environment** do serviço no Render com a chave atual. A variável local e a variável do Render são independentes; não coloque a chave em arquivo ou variável `VITE_*`.
- [ ] Fazer o deploy/redeploy no Render quando desejar. Nenhum deploy foi executado pelo Manus.
- [ ] O fornecedor não identifica a diferença entre PT-BR e PT-PT; a marcação disponível é apenas `pt`/`[Dublado]`.
- [ ] Cobertura do índice não é completa por limitação do fornecedor: várias rotas ignoram paginação e não há uma listagem global. A busca API retorna até aproximadamente 26 correspondências por termo.

## Instalação móvel e janela flutuante

- [x] O app deve poder ser instalado como web app (PWA), sem APK, em Android e iOS; a tela inicial deve ter um botão de instalação com visual alinhado à marca. O botão deve abrir o prompt nativo quando o navegador o oferecer e, no iPhone, orientar a instalação manual pela Tela de Início.
- [x] Enquanto um episódio estiver tocando, o usuário deve poder ativar Picture-in-Picture para manter o vídeo em janela flutuante ao alternar para o WhatsApp, quando navegador e sistema oferecerem suporte; se não oferecerem, mostrar uma orientação clara sem encerrar o player.
