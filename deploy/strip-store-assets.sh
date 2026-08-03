#!/usr/bin/env bash
#
# Drop store artwork from a built dist/ before it is packed for a platform.
#
# The covers live in packages/client/public so they stay versioned next to the
# game, but every platform takes them through its own console — nobody fetches
# them from the build. index.html points at https://wheee.io/og-image.png by
# absolute URL, so even that copy is never read out of the bundle. Left in, they
# are megabytes each player downloads and never sees.
#
# Web builds (wheee.io, ru.wheee.io) are deliberately left alone: og-image.png
# has to stay reachable at that absolute URL.
set -euo pipefail

DIST="${1:?usage: strip-store-assets.sh <dist-dir>}"

STORE_ASSETS=(
  'cover-1920x1080.png'
  'cover-ru-1920x1080.png'
  'yandex-cover.png'
  'og-image.png'
)

freed=0
for name in "${STORE_ASSETS[@]}"; do
  file="$DIST/$name"
  [[ -f "$file" ]] || continue
  freed=$(( freed + $(wc -c < "$file") ))
  rm -f "$file"
  echo "    - $name"
done

if (( freed > 0 )); then
  echo "    $(( freed / 1024 )) KB kept out of the archive"
else
  echo "    nothing to strip"
fi
