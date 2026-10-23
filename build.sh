#!/usr/bin/env bash
# Re-bundle isomorphic-git and the `buffer` polyfill for browsers:
#
#   npm install && ./build.sh
#
# The sandbox's own scripts need no build: they ship as they are in
# _extensions/git-sandbox/resources/, which is what `quarto add` installs.

set -euo pipefail
cd "$(dirname "$0")"

OUT=_extensions/git-sandbox/resources/isomorphic-git.bundle.js
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
./node_modules/.bin/esbuild vendor/entry.js --bundle --minify --format=iife \
  --target=es2018 --legal-comments=none --outfile="$TMP/bundle.js"
{
  cat <<'HDR'
/*! isomorphic-git (MIT) + the `buffer` polyfill (MIT), bundled for browsers.

    Exposes a global `git`. The polyfill is not optional: isomorphic-git's
    index code calls a global Buffer, which browsers do not provide, so a bare
    CDN copy of isomorphic-git fails at the first `git add`.

    Rebuild with: npm install && ./build.sh   (see vendor/entry.js)
    Licences: https://github.com/isomorphic-git/isomorphic-git/blob/main/LICENSE.md
              https://github.com/feross/buffer/blob/master/LICENSE            */
HDR
  cat "$TMP/bundle.js"
} > "$OUT"
node --check "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
