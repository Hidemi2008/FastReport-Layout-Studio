#!/usr/bin/env bash
# Cria a sequência de commits (Conventional Commits) do módulo DAV Studio.
# Uso: bash scripts/git-commits.sh   (na raiz do projeto, com o repositório já inicializado)
set -euo pipefail

c() { local msg="$1"; shift; git add -- "$@"; git commit -q -m "$msg"; echo "✔ $msg"; }

c "chore: inicializa projeto Node com Express e SQLite" \
  package.json package-lock.json .gitignore .env.example

c "feat(db): adiciona schema relacional de DAV, itens, negociação, config e auditoria" \
  db/schema.sql src/db.js

c "feat(core): adiciona máscaras numéricas pt-BR e utilitários de formatação" \
  src/services/format.js

c "feat(audit): registra trilha de auditoria de criação, impressão e alterações" \
  src/services/audit.js

c "feat(config): adiciona configurador dinâmico com defaults, validação e restauração" \
  src/services/config.js

c "feat(dav): implementa QryPrincipal, QryItens, QryNegociacao e rateio de descontos" \
  src/services/dav.js

c "feat(render): adiciona impressão gráfica (A4/meia página) e térmica (bobina 58/80mm)" \
  src/services/render.js

c "feat(validade): expira orçamentos vencidos e renova com recálculo de preços" \
  src/services/validity.js

c "feat(export): adiciona exportação por WhatsApp, PDF e e-mail" \
  src/services/export.js

c "feat(api): expõe API REST, servidor, sincronização offline e dados de exemplo" \
  src/routes/api.js src/app.js src/server.js src/seed.js

c "feat(ui): adiciona interface com DlgConfig, preview ao vivo e observação por item" \
  public/index.html public/styles.css public/app.js

c "test: cobre cálculos, rateio, kits, configuração, render e API" \
  tests/helpers.js tests/dav.test.js tests/api.test.js

c "docs: adiciona README, arquitetura e script de commits" \
  README.md docs/ARQUITETURA.md scripts/git-commits.sh

git log --oneline
