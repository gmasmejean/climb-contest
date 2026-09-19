#!/bin/sh
# Prouve qu'une sauvegarde se RESTAURE (Lot 9) — sans toucher aux données
# vivantes : la sauvegarde est rechargée dans une base jetable, puis on compare
# le nombre de lignes de CHAQUE table avec la base source.
#
#   infra/scripts/verify-restore.sh                       # sauvegarde neuve, puis vérifie
#   infra/scripts/verify-restore.sh backups/xxx.dump      # vérifie une sauvegarde existante
#
# Code de sortie 0 = identique, 1 = écart. Une sauvegarde jamais restaurée
# n'est qu'une hypothèse : lancez ceci régulièrement (voir docs/EXPLOITATION.md).
set -eu

COMPOSE="${COMPOSE:-docker compose}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/../docker" && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
scratch="climbcontest_verify_$$"

dump="${1:-}"
if [ -z "$dump" ]; then
  BACKUP_DIR="$BACKUP_DIR" COMPOSE="$COMPOSE" COMPOSE_DIR="$COMPOSE_DIR" "$(dirname "$0")/backup.sh" > /dev/null
  # shellcheck disable=SC2012
  dump="$(ls -1t "$(cd "$BACKUP_DIR" && pwd)"/climbcontest-*[0-9].dump | head -n 1)"
fi
[ -s "$dump" ] || { echo "ERREUR : $dump est introuvable ou vide." >&2; exit 2; }
echo "Sauvegarde vérifiée : $dump"

cd "$COMPOSE_DIR"
psql_src() { $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -c \"$1\""; }
psql_scratch() { $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $scratch -At -c \"$1\""; }

cleanup() { $COMPOSE exec -T postgres sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $scratch" > /dev/null 2>&1 || true; }
trap cleanup EXIT

$COMPOSE exec -T postgres sh -c "createdb -U \"\$POSTGRES_USER\" $scratch"
$COMPOSE exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $scratch --no-owner --exit-on-error" < "$dump"

tables="$(psql_src "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")"
[ -n "$tables" ] || { echo "ERREUR : la base source n'a aucune table." >&2; exit 1; }

status=0
printf '%-24s %10s %10s\n' TABLE SOURCE RESTAUREE
for table in $tables; do
  source_count="$(psql_src "select count(*) from \\\"$table\\\"")"
  restored_count="$(psql_scratch "select count(*) from \\\"$table\\\"" 2>/dev/null || echo MANQUANTE)"
  mark=''
  if [ "$source_count" != "$restored_count" ]; then mark='  ← ÉCART'; status=1; fi
  printf '%-24s %10s %10s%s\n' "$table" "$source_count" "$restored_count" "$mark"
done

if [ "$status" -eq 0 ]; then
  echo "OK : la sauvegarde se restaure et contient exactement les mêmes données."
else
  echo "ÉCHEC : la sauvegarde ne correspond pas à la base source." >&2
fi
exit "$status"
