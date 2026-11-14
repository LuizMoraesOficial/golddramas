# TODO — Drama Reels

- [x] **Sessão de visitante e estados de rede:** Ao abrir o site, autenticar automaticamente como visitante usando um `deviceId` persistente, manter o token durante o teste e exibir estados claros de carregamento/erro/retry sem expor credenciais.
- [x] **Catálogo completo em páginas:** Exibir a lista de doramas da nuvem em lotes de 30, carregar páginas adicionais automaticamente conforme o usuário se aproxima do fim e manter cada capa clicável.
- [x] **Pesquisa com lupa:** Exibir uma lupa/campo de pesquisa no catálogo, consultar a API pelo parâmetro `busca` após uma breve pausa na digitação, substituir os resultados pela busca e permitir limpar o termo para voltar ao catálogo completo.
- [x] **Detalhe do dorama:** Ao clicar em uma capa, abrir o dorama escolhido, carregar seus dados por ID e mostrar título, sinopse, metadados, temporadas e episódios disponíveis.
- [x] **Reprodução por episódio:** Permitir selecionar e assistir episódios separadamente, buscando os links pela rota de stream com `dramaId`, `temporadaNumero` e `episodioNumero`, com loading e erro visíveis.
- [x] **Player vertical estilo Reels:** Abrir o player em tela cheia, otimizado para celular, permitir deslizar para cima para o episódio seguinte e para baixo para o anterior, com botões de fechar, play/pause, áudio e indicação do episódio atual.
- [x] **Sessão de stream:** Manter heartbeat durante a reprodução, enviar o formato pelo header correto e encerrar a sessão ao sair do player.
- [x] **Responsividade e acabamento visual:** Aplicar a direção Cinema Noturno Neon, preservar a experiência vertical em celular e oferecer uma composição utilizável em desktop.
- [x] **Serviço e entrega:** Servir o protótipo no Preview configurado, expor `manus-routes.json`, passar build/checks e salvar o código em checkpoint.
