# Autenticação privada automática

O site pode usar uma conta autorizada configurada no serviço de hospedagem sem expor a senha no navegador.

## Variáveis do serviço

Configure duas variáveis privadas no provedor de hospedagem:

```text
GOLDDRAMAS_LOGIN=seu-email
GOLDDRAMAS_SENHA=sua-senha
```

Por compatibilidade, o servidor também aceita `LOGIN` e `SENHA`, mas os nomes com prefixo `GOLDDRAMAS_` são recomendados para evitar conflitos.

## Fluxo

1. O navegador faz a primeira chamada para `/api/auth/app/visitante`.
2. O servidor detecta as secrets e chama `POST https://api.dsstv.online/api/v1/auth/app/login` com `{"email":"...","senha":"..."}`.
3. O token real fica somente na memória do servidor.
4. O servidor usa esse token nas chamadas `/api/app/*`, incluindo catálogo, detalhe, stream, heartbeat e encerramento.
5. O navegador recebe apenas um identificador interno de sessão, nunca o JWT real da conta.
6. Quando o token expira ou a API responde 401, o servidor autentica novamente de forma automática.

Sem as variáveis privadas, o site continua usando a sessão visitante normal.

## Segurança

Não coloque essas variáveis no frontend, no arquivo `.env` versionado, no ZIP ou em mensagens. Proteja também o próprio site: qualquer pessoa que consiga acessar uma instância com as secrets poderá consumir a conta configurada. Use o recurso de secrets do provedor e um serviço privado ou uma proteção adicional por código de acesso quando o site não for exclusivamente local.
