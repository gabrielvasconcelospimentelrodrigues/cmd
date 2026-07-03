# CMD SaaS — Frontend (React + Vite + Tailwind)

Painel web. Autentica via Supabase Auth e consome a API Fastify (`backend/`).

## Stack
- **React 18 + Vite 5 + TypeScript**
- **Tailwind CSS 3**
- **@supabase/supabase-js** — login (anon key)

## Setup
```bash
cd frontend
npm install
cp .env.example .env   # já existe um .env preenchido p/ o projeto novo
npm run dev            # http://localhost:5173
```

## Telas
- **Login / Criar conta** — Supabase Auth.
- **Dashboard:**
  - Onboarding automático (cria a clínica no 1º acesso).
  - Conectar contas CMD-COLETA (credenciais cifradas no backend).
  - Enviar arquivo (CSV/Excel/XML) → extração na fila.
  - Acompanhar envios (status em tempo real, polling) e ver pacientes extraídos.

## Rodar a stack completa (3 terminais)
```bash
# 1) Workers (precisa do REDIS_URL Upstash no workers/.env)
cd workers && npm run dev
# 2) Backend (porta 3333)
cd backend && npm run dev
# 3) Frontend (porta 5173)
cd frontend && npm run dev
```

> ⚠️ **Confirmação de e-mail:** se o projeto Supabase estiver com "Confirm email"
> ligado (Authentication → Providers → Email), o cadastro não loga na hora —
> confirme pelo e-mail ou desligue a opção para testes.

## Variáveis (.env)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — projeto Supabase (anon é pública).
- `VITE_API_URL` — URL do backend (default `http://localhost:3333`).
