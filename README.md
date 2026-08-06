# Green Engine

Base inicial da plataforma de inteligência esportiva. O monorepo contém uma API NestJS, o aplicativo Flutter, um dashboard Next.js e o esquema PostgreSQL.

## Domínios entregues nesta base

- **Health**: verificação de disponibilidade da API.
- **Green 15K**: criação de ciclo, registro de GREEN/RED e reinício automático após RED.
- **Bankroll**: estrutura de dados preparada para evolução do controle financeiro.
- **Auditoria**: eventos de mudança de estado previstos no esquema do banco.

## Estrutura

```text
apps/api       API NestJS
apps/mobile    Aplicativo Flutter
apps/dashboard Dashboard Next.js
database       Esquema inicial PostgreSQL
```

## Desenvolvimento local

1. Copie `.env.example` para `.env` e ajuste as variáveis.
2. Suba PostgreSQL e Redis com `docker compose up -d`.
3. Em `apps/api`, instale as dependências e execute `npm run start:dev`.
4. Execute o dashboard em `apps/dashboard` com `npm run dev`.

O armazenamento do módulo Green 15K é temporariamente em memória nesta primeira entrega. A interface do serviço foi mantida isolada para a próxima etapa conectar um repositório PostgreSQL sem alterar as regras de negócio.
