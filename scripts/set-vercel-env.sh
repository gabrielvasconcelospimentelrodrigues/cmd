#!/usr/bin/env bash
# Envia as variáveis de um arquivo .env para o projeto Vercel JÁ LINKADO
# (production). Os segredos são lidos do .env local — não aparecem em lugar
# nenhum. Overrides na linha de comando têm prioridade sobre o .env.
#
# Uso (dentro da pasta do projeto já linkado com `vercel link`):
#   bash ../scripts/set-vercel-env.sh .env CHAVE=valor OUTRA=valor
#
set -euo pipefail

ENVFILE="${1:-.env}"; shift || true
declare -A EXTRA
for kv in "$@"; do EXTRA["${kv%%=*}"]="${kv#*=}"; done

put() { # KEY VALUE
  local k="$1" v="$2"
  [ -z "$v" ] && { echo "  · $k (vazio, pulado)"; return 0; }
  vercel env rm "$k" production -y >/dev/null 2>&1 || true
  printf '%s' "$v" | vercel env add "$k" production >/dev/null 2>&1 && echo "  ✓ $k"
}

# 1) Overrides passados na linha de comando
for k in "${!EXTRA[@]}"; do put "$k" "${EXTRA[$k]}"; done

# 2) Demais chaves do .env (sem sobrescrever os overrides)
while IFS='=' read -r k v || [ -n "$k" ]; do
  [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  [[ -n "${EXTRA[$k]+x}" ]] && continue
  v="${v%$'\r'}"                    # remove CR do Windows
  v="${v%\"}"; v="${v#\"}"          # remove aspas externas
  put "$k" "$v"
done < "$ENVFILE"

echo "Pronto. Rode 'vercel --prod' para publicar com as novas variáveis."
