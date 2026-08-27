#!/usr/bin/env bash
# 应用迁移（以 edm_migrator 连接）。
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

MIGRATOR_URL="${DATABASE_URL:-postgresql://edm_migrator@localhost:5432/edm}"

psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS edm.migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

for f in migrations/*.sql; do
  base="$(basename "$f")"
  applied="$(psql "$MIGRATOR_URL" -tAc "SELECT 1 FROM edm.migrations WHERE filename = '$base'" 2>/dev/null)"
  if [ -n "$applied" ]; then
    echo "= 已应用（跳过）$f"
    continue
  fi
  echo "→ 应用 $f"
  psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO edm.migrations (filename) VALUES ('$base');"
done

echo "迁移完成。"
