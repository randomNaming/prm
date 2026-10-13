#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/.data/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [ -f "$ROOT_DIR/.env" ]; then
	set -a
	# shellcheck disable=SC1091
	. "$ROOT_DIR/.env"
	set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL 未配置：请先复制 .env.example 为 .env 并填写 MySQL 连接串。" >&2
	exit 1
fi

if ! command -v mysqldump >/dev/null 2>&1; then
	echo "找不到 mysqldump：请安装 MySQL 8.0 客户端，或把它的 bin 目录加入 PATH。" >&2
	exit 1
fi

url_decode() {
	printf '%b' "${1//%/\\x}"
}

REST="${DATABASE_URL#*://}"
CREDENTIALS="${REST%@*}"
HOST_PART="${REST##*@}"
DB_USER="$(url_decode "${CREDENTIALS%%:*}")"
DB_PASS="$(url_decode "${CREDENTIALS#*:}")"
DB_HOST="${HOST_PART%%:*}"
DB_PORT_AND_NAME="${HOST_PART#*:}"
DB_PORT="${DB_PORT_AND_NAME%%/*}"
DB_NAME="${DB_PORT_AND_NAME#*/}"

if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ "$DB_NAME" = "$DB_PORT_AND_NAME" ]; then
	echo "DATABASE_URL 解析失败：期望形如 mysql://user:pass@host:3306/dbname" >&2
	exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/crm-mini-$STAMP.sql"

export MYSQL_PWD="$DB_PASS"

mysqldump \
	--host="$DB_HOST" \
	--port="${DB_PORT:-3306}" \
	--user="$DB_USER" \
	--single-transaction \
	--quick \
	--default-character-set=utf8mb4 \
	--set-gtid-purged=OFF \
	--no-tablespaces \
	--result-file="$TARGET" \
	"$DB_NAME"

unset MYSQL_PWD

gzip -f "$TARGET"

echo "备份完成：$TARGET.gz"
echo "恢复命令：gunzip -c \"$TARGET.gz\" | MYSQL_PWD='***' mysql --host=$DB_HOST --port=${DB_PORT:-3306} --user=$DB_USER $DB_NAME"

find "$BACKUP_DIR" -name 'crm-mini-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "已清理 $KEEP_DAYS 天前的旧备份。"
