# TODO — GoldDramas

- [x] Preservar o app React/Vite e sua interface.
- [x] Remover a caixa de chave, endpoint de importação e estado em memória; a interface não exibe nome do fornecedor nem segredo.
- [x] Usar `APISHORT_API_KEY` exclusivamente pelo servidor (`process.env`); `.env` local é ignorado pelo Git e `.env.example` não contém segredo.
- [x] Substituir a chave local em `.env` pela nova credencial recebida em campo privado; reiniciar o backend e validar `popular` com HTTP 200.
- [x] Preparar Render: build/start e variáveis documentados. Nenhum deploy foi feito.
- [x] “Todos” combina e deduplica `popular` p1, `new` p1–p2 e `category/1` p1, mantendo somente títulos marcados como dublados em português. Uma amostra ao vivo anterior encontrou 68 IDs únicos; a primeira lista popular tinha 28 itens marcados (25 IDs únicos).
- [x] “Novidades” inclui as duas páginas com itens novos na amostra. Não inventar índices de categorias não documentados.
- [x] Manter detalhe e player HLS com relay limitado ao domínio de mídia autorizado.
- [x] TypeScript, build, teste sintético de deduplicação e verificação de `.env` sem chave real aprovados.
- [x] Validar a união ao vivo com a nova chave: “Todos” mostra 68 IDs únicos e “Novidades” 45; o Preview não mostra formulário nem nome do fornecedor.
- [ ] O usuário precisa cadastrar `APISHORT_API_KEY` no Environment do serviço Render para o deploy remoto; Git não transfere segredos.
- [ ] Confirmar com fornecedor se `[Dublado]` significa PT-BR especificamente; a API só identificou `pt`.
- [ ] Confirmar índice de categorias, busca remota e paginação com o fornecedor.
