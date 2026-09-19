#!/bin/sh
# Restauration de ClimbContest depuis une sauvegarde (Lot 9).
#
#   infra/scripts/restore.sh backups/climbcontest-20260919-100000.dump          # simulation
#   infra/scripts/restore.sh backups/climbcontest-20260919-100000.dump --yes    # pour de vrai
#   infra/scripts/restore.sh <dump> --yes --uploads backups/<...>-uploads.tar.gz
#
# DESTRUCTIF : remplace TOUTES les données actuelles par celles de la
# sauvegarde. Sans --yes, le script dit ce qu'il ferait et s'arrête. L'API est
# arrêtée pendant la restauration, puis relancée.
set -eu

COMPOSE="${COMPOSE:-docker compose}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/../docker" && pwd)}"

dump="${1:-}"
[ -n "$dump" ] || { echo "Usage : $0 <fichier.dump> [--yes] [--uploads <archive.tar.gz>]" >&2; exit 2; }
[ -s "$dump" ] || { echo "ERREUR : $dump est introuvable ou vide." >&2; exit 2; }
dump="$(cd "$(dirname "$dump")" && pwd)/$(basename "$dump")"
shift

yes=no
uploads=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=yes ;;
    --uploads) shift; uploads="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$yes" != yes ]; then
  echo "SIMULATION — rien n'est modifié."
  echo "Avec --yes, ce script :"
  echo "  1. arrête l'API ;"
  echo "  2. REMPLACE toute la base par le contenu de $dump ;"
  [ -n "$uploads" ] && echo "  3. remplace les vidéos par $uploads ;"
  echo "  4. relance l'API."
  echo "Refaites la commande avec --yes pour l'exécuter."
  exit 1
fi

cd "$COMPOSE_DIR"
echo "→ Arrêt de l'API…"
$COMPOSE stop api

echo "→ Restauration de la base…"
# Fichier transmis en entier d'abord (voir backup.sh), puis restauré depuis le conteneur.
$COMPOSE exec -T postgres sh -c 'cat > /tmp/restore.dump && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error /tmp/restore.dump; status=$?; rm -f /tmp/restore.dump; exit $status' < "$dump"

if [ -n "$uploads" ]; then
  echo "→ Restauration des vidéos…"
  $COMPOSE run --rm --no-deps -T api sh -c 'rm -rf /data/uploads/* && tar xzf - -C /data/uploads' < "$uploads"
fi

echo "→ Relance de l'API…"
$COMPOSE start api
echo "Terminé. Vérifiez : curl http://localhost:8080/health"
