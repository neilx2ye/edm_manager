#!/usr/bin/env bash
# 初始化数据库角色与数据库（幂等）。以 root/sudo 执行：
#   sudo bash scripts/setup-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."

gen_pass() {
  openssl rand -base64 24 | tr -d '/+=' | cut -c1-32
}

MIGRATOR_PASS="${EDM_MIGRATOR_PASSWORD:-$(gen_pass)}"
APP_PASS="${EDM_APP_PASSWORD:-$(gen_pass)}"
SERVICE_PASS="${EDM_SERVICE_PASSWORD:-$(gen_pass)}"
AUTH_SECRET="$(openssl rand -base64 33 | tr -d '\n')"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edm_migrator') THEN
    CREATE ROLE edm_migrator LOGIN PASSWORD '${MIGRATOR_PASS}';
  ELSE
    ALTER ROLE edm_migrator WITH LOGIN PASSWORD '${MIGRATOR_PASS}';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edm_app') THEN
    CREATE ROLE edm_app LOGIN PASSWORD '${APP_PASS}';
  ELSE
    ALTER ROLE edm_app WITH LOGIN PASSWORD '${APP_PASS}';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edm_service') THEN
    CREATE ROLE edm_service LOGIN PASSWORD '${SERVICE_PASS}' BYPASSRLS;
  ELSE
    ALTER ROLE edm_service WITH LOGIN PASSWORD '${SERVICE_PASS}' BYPASSRLS;
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='edm'" | grep -q 1; then
  sudo -u postgres createdb -O edm_migrator edm
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE edm_app SET search_path = edm, public;
ALTER ROLE edm_service SET search_path = edm, public;
ALTER DATABASE edm OWNER TO edm_migrator;
SQL

# 扩展与 schema 所有权
sudo -u postgres psql -d edm -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION edm_migrator;
CREATE SCHEMA IF NOT EXISTS edm AUTHORIZATION edm_migrator;
GRANT USAGE ON SCHEMA auth TO edm_app, edm_service;
GRANT USAGE ON SCHEMA edm TO edm_app, edm_service;
SQL

STORAGE_DIR="${EDM_STORAGE_DIR:-/var/lib/edm/storage}"
sudo mkdir -p "$STORAGE_DIR"
sudo chown -R "$(id -un):$(id -gn)" "$STORAGE_DIR"

if [ -f .env ]; then
  echo "已存在 .env，跳过写入（保留现有密钥）。"
else
  cat > .env <<EOF
DATABASE_URL=postgresql://edm_migrator:${MIGRATOR_PASS}@localhost:5432/edm
EDM_APP_DATABASE_URL=postgresql://edm_app:${APP_PASS}@localhost:5432/edm
EDM_SERVICE_DATABASE_URL=postgresql://edm_service:${SERVICE_PASS}@localhost:5432/edm
AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
EDM_STORAGE_DIR=${STORAGE_DIR}
PORT=3000
EOF
  chmod 600 .env
  echo "已生成 .env"
fi

echo "数据库角色与 edm 数据库就绪。"
