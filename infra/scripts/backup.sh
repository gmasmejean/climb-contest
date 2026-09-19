#!/bin/sh
# Sauvegarde manuelle de ClimbContest (Lot 9) : la base PostgreSQL et, si elles
# existent, les vidéos téléversées.
#
#   infra/scripts/backup.sh                 # écrit dans ./backups
#   BACKUP_DIR=/mnt/usb KEEP=30 infra/scripts/backup.sh
#   COMPOSE="podman compose" infra/scripts/backup.sh
#
# Le fichier n'est publié (renommé) qu'APRÈS avoir été relu par `pg_restore
# --list` : une sauvegarde tronquée n'est jamais présentée comme valide. Les
# plus anciennes sont supprimées au-delà de KEEP (14 par défaut).
set -eu

COMPOSE="${COMPOSE:-docker compose}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/../docker" && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
stamp="$(date +%Y%m%d-%H%M%S)"
dump="$BACKUP_DIR/climbcontest-$stamp.dump"

cd "$COMPOSE_DIR"

echo "→ Sauvegarde de la base…"
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$dump.partial"

if [ ! -s "$dump.partial" ]; then
  rm -f "$dump.partial"
  echo "ERREUR : la sauvegarde est vide. Rien n'a été écrit." >&2
  exit 1
fi
# Relecture : un fichier illisible n'est pas une sauvegarde.
if ! $COMPOSE exec -T postgres pg_restore --list < "$dump.partial" > /dev/null; then
  rm -f "$dump.partial"
  echo "ERREUR : la sauvegarde est illisible. Rien n'a été écrit." >&2
  exit 1
fi
mv "$dump.partial" "$dump"
echo "  $dump ($(wc -c < "$dump" | tr -d ' ') octets)"

# Vidéos : seulement si le volume en contient.
uploads="$BACKUP_DIR/climbcontest-$stamp-uploads.tar.gz"
if $COMPOSE exec -T api sh -c 'test -d /data/uploads && [ -n "$(ls -A /data/uploads 2>/dev/null)" ]'; then
  echo "→ Sauvegarde des vidéos…"
  $COMPOSE exec -T api tar czf - -C /data/uploads . > "$uploads.partial"
  mv "$uploads.partial" "$uploads"
  echo "  $uploads"
else
  echo "→ Aucune vidéo téléversée : rien à sauvegarder de ce côté."
fi

# Rotation : on garde les KEEP plus récentes de chaque sorte.
for pattern in 'climbcontest-*[0-9].dump' 'climbcontest-*-uploads.tar.gz'; do
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
    echo "  supprimé (rotation) : $old"
  done
done
echo "Terminé."
