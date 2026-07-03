# CMD SaaS — Backend (Fastify + TypeScript)

API assíncrona e leve. Conecta no Supabase (Postgres + Auth) e enfileira
automações no Redis/BullMQ (consumidas pelos `workers/`).

## Stack
- **Fastify 5** — HTTP server async, baixo overhead
- **@supabase/supabase-js** — acesso ao banco via service_role (ignora RLS)
- **pg** — pool Postgres direto (migrations/queries pontuais)
- **ioredis** — conexão Redis (fila BullMQ)
- **zod** — validação das envs no boot

## Setup
```bash
cd backend
npm install
cp .env.example .env   # já existe um .env preenchido p/ o projeto novo
npm run check:conn     # valida Supabase + Postgres + Redis
npm run dev            # sobe a API em http://localhost:3333
```

> Redis: para os workers/BullMQ você precisa de um Redis rodando.
> Local rápido: `docker run -p 6379:6379 redis:7-alpine`

## Rotas
- `GET /health` — liveness
- `GET /health/ready` — readiness (checa Supabase + Redis)

## Estrutura
```
src/
├── config/env.ts          Validação/tipagem das variáveis de ambiente
├── lib/
│   ├── supabase.ts        Client admin (service_role)
│   ├── db.ts              Pool Postgres (pg)
│   └── redis.ts           Conexão Redis (BullMQ)
├── types/database.ts      Tipos das 9 tabelas (espelham sql/001_init.sql)
├── routes/health.ts       Healthcheck
├── scripts/check-connections.ts
└── server.ts              Bootstrap Fastify
```

## SQL / Migrations
- `sql/001_init.sql` — schema inicial (rode no SQL Editor do Supabase)
- `sql/NOTAS_MIGRACAO.md` — mapa do banco antigo → novo
