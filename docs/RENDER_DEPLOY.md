# Configuração no Render (sem publicar pelo Manus)

## Variável obrigatória

No serviço Web do Render, abra **Environment** e crie:

| Nome | Valor |
|---|---|
| `APISHORT_API_KEY` | sua chave privada fornecida pelo serviço de catálogo |

Opcionalmente, defina `APISHORT_BASE_URL=https://apishort.com` e `APISHORT_PROVIDER=shortmax`; o código já usa esses valores como padrão. O Render fornece `PORT` automaticamente.

Salve as mudanças no Environment do serviço e aguarde o redeploy do Render. Segredos cadastrados ali ficam na configuração do serviço e não devem ser adicionados ao repositório, ao `vite.config.ts`, a variáveis `VITE_*` ou ao frontend.

## Comandos do serviço

- **Build Command:** `pnpm install --frozen-lockfile && pnpm build`
- **Start Command:** `pnpm start`
- **Runtime:** Node.js

O servidor Express serve o build estático e lê a chave diretamente de `process.env.APISHORT_API_KEY`. Nenhum arquivo `.env` precisa ser enviado ao Render.

## Execução local

Copie `.env.example` para `.env` e preencha `APISHORT_API_KEY`. O servidor carrega esse arquivo ao iniciar. O `.gitignore` já exclui `.env`; valide que ele não está sendo rastreado antes do push (`git status --short`). Nunca force a inclusão do arquivo. A chave local e a variável do Render são configurações separadas: preencher uma não configura automaticamente a outra.

Esta tarefa prepara o código e as instruções; não conecta ao Render, não executa redeploy nem publica o projeto.
