#!/bin/sh
# Déploiement d'une version de ClimbContest sur le VPS (Lot 22, ADR-084).
#
#   ./deploy.sh <version>        # version = tag d'image (sha du commit)
#   ./deploy.sh "$(cat .previous-tag)"   # retour à la version précédente
#
# Lancé par le workflow `deploy.yml` après chaque push sur `production`, et
# relançable à la main depuis /opt/climbcontest. Étapes :
#   1. télécharger les images de la version ;
#   2. démarrer Postgres et le sauvegarder (backup.sh) — si la sauvegarde
#      échoue, on s'arrête : RIEN n'a encore changé ;
#   3. appliquer les migrations ;
#   4. remplacer l'API et Caddy, attendre que l'API réponde sur /health.
#
# Pas de retour arrière automatique : une migration appliquée peut rendre
# l'ancienne version incompatible avec la base. En cas d'échec, le script dit
# quoi faire ; la décision reste humaine.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

fail() {
  echo "ÉCHEC : $*" >&2
  exit 1
}

tag="${1:-}"
[ -n "$tag" ] || fail "indiquez la version à déployer : ./deploy.sh <version>"
case "$tag" in
  *[!A-Za-z0-9._-]*) fail "version invalide : « $tag » (lettres, chiffres, . _ - uniquement)" ;;
esac
[ -f .env ] || fail "fichier $here/.env introuvable. Copiez .env.example en .env et remplissez-le (docs/EXPLOITATION.md)."
[ -f compose.yaml ] || fail "fichier $here/compose.yaml introuvable."

previous="$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n 1)"
# La version vient de la ligne de commande, pas du `.env` : tant que la
# sauvegarde n'est pas faite, le `.env` décrit toujours ce qui tourne.
export IMAGE_TAG="$tag"

echo "→ Version $tag (en place : ${previous:-aucune})"

echo "→ Téléchargement des images…"
docker compose pull --quiet migrate api caddy postgres backup \
  || fail "images introuvables pour la version $tag. Vérifiez que la CI les a publiées et qu'elles sont publiques sur ghcr.io."

echo "→ Démarrage de la base…"
docker compose up -d --wait postgres || fail "la base ne démarre pas. Voir : docker compose logs postgres"

echo "→ Sauvegarde avant migration…"
COMPOSE="docker compose" COMPOSE_DIR="$here" BACKUP_DIR="$here/backups" KEEP="${KEEP:-14}" \
  "$here/backup.sh" \
  || fail "sauvegarde impossible : déploiement annulé, la version ${previous:-aucune} reste en place."

# À partir d'ici, ce qui tourne change : le `.env` suit.
if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env
else
  printf 'IMAGE_TAG=%s\n' "$tag" >> .env
fi
if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
  printf '%s\n' "$previous" > .previous-tag
fi

rollback_hint() {
  if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
    echo "  Pour revenir à la version précédente : ./deploy.sh $previous" >&2
    echo "  Si cette version a appliqué des migrations, défaites-les AVANT : voir" >&2
    echo "  docs/EXPLOITATION.md § 9 « Revenir en arrière »." >&2
  fi
}

echo "→ Migrations…"
if ! docker compose run --rm migrate; then
  echo "ÉCHEC : les migrations n'ont pas abouti. L'API en place n'a pas été remplacée." >&2
  rollback_hint
  exit 1
fi

echo "→ Remplacement de l'API et du serveur web…"
if ! docker compose up -d --remove-orphans --wait --wait-timeout 180 api caddy backup; then
  docker compose logs --tail 60 api caddy >&2 || true
  echo "ÉCHEC : la nouvelle version ne répond pas (journaux ci-dessus)." >&2
  rollback_hint
  exit 1
fi

# Les images de plus de 30 jours qui ne servent plus : un retour arrière récent
# reste instantané, les plus anciens seront simplement retéléchargés.
docker image prune -af --filter until=720h > /dev/null || true

echo "✓ Version $tag en ligne."
