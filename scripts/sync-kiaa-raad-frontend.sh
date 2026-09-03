#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPO='kiaa-raad/gravitasplus'
UPSTREAM_URL="https://github.com/${UPSTREAM_REPO}.git"
UPSTREAM_DIR='/tmp/gravitasplus-upstream'
MARKER='.upstream-gravitasplus'

PREVIOUS="$(cat "$MARKER" 2>/dev/null || true)"
rm -rf "$UPSTREAM_DIR"
git clone -q "$UPSTREAM_URL" "$UPSTREAM_DIR"
UPSTREAM_SHA="$(git -C "$UPSTREAM_DIR" rev-parse HEAD)"

echo "Previous upstream: ${PREVIOUS:-none}"
echo "Latest upstream:   $UPSTREAM_SHA"

# IMPORTANT: even when Kiarash has no new commit, do NOT exit here.
# The canonical visual core is mirrored on every run so production can never
# remain on an older shared stylesheet/JS just because the marker is current.
if [ "$PREVIOUS" = "$UPSTREAM_SHA" ]; then
  echo 'No Kiarash update detected; verifying canonical visual parity anyway.'
fi

if [ -z "$PREVIOUS" ] || ! git -C "$UPSTREAM_DIR" cat-file -e "${PREVIOUS}^{commit}" 2>/dev/null; then
  echo "Recorded revision is missing upstream; using the latest parent as a conservative baseline."
  PREVIOUS="$(git -C "$UPSTREAM_DIR" rev-parse "${UPSTREAM_SHA}^" 2>/dev/null || printf '%s' "$UPSTREAM_SHA")"
fi

mapfile -t CHANGED < <(
  git -C "$UPSTREAM_DIR" diff --name-only "$PREVIOUS" "$UPSTREAM_SHA" -- '*.html' 'assets/**' \
  | grep -Ev '^assets/(production-bridge\.js|local-fonts\.css|fonts/|upstream-[^/]+\.css$)' || true
)

if [ "${#CHANGED[@]}" -gt 0 ]; then
  printf 'Frontend changes from Kiarash:\n'
  printf ' - %s\n' "${CHANGED[@]}"

  for f in "${CHANGED[@]}"; do
    case "$f" in
      *.html|assets/*)
        if [ -e "$UPSTREAM_DIR/$f" ]; then
          mkdir -p "$(dirname "$f")"
          cp -a "$UPSTREAM_DIR/$f" "$f"
        else
          rm -f "$f"
        fi
        ;;
    esac
  done
else
  echo 'No HTML/assets delta from Kiarash.'
fi

# These files jointly define the public landing-page geometry and behavior.
# Mirror them unconditionally. A delta-only sync can miss an older divergence
# when the marker already points at the newest upstream commit (the exact bug
# that left production site.css/site.js behind while hero.css was current).
CANONICAL_VISUAL_CORE=(
  index.html
  assets/gravitas.css
  assets/site.css
  assets/site.js
  assets/hero.css
  assets/hero.js
  assets/chat.css
  assets/chat.js
  assets/brand.css
  assets/brand.js
)
for f in "${CANONICAL_VISUAL_CORE[@]}"; do
  if [ ! -f "$UPSTREAM_DIR/$f" ]; then
    echo "Missing required upstream visual file: $f" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$f")"
  cp -a "$UPSTREAM_DIR/$f" "$f"
done

# Artwork is design-owned and safe to mirror wholesale.
rm -rf assets/thumbnails
if [ -d "$UPSTREAM_DIR/assets/thumbnails" ]; then
  mkdir -p assets
  cp -a "$UPSTREAM_DIR/assets/thumbnails" assets/thumbnails
fi

printf '%s\n' "$UPSTREAM_SHA" > "$MARKER"

# Re-apply only non-visual production integration after Kiarash's files land.
# No hero/site/brand CSS or markup is reconstructed here.
python3 - "$UPSTREAM_SHA" <<'PY'
from pathlib import Path
import hashlib
import re
import sys

sha = sys.argv[1]
local_css = Path('assets/local-fonts.css')

# Cache keys change when the sync guard or self-hosted font declarations change.
h = hashlib.sha256()
h.update(Path('scripts/sync-kiaa-raad-frontend.sh').read_bytes())
if local_css.exists():
    h.update(local_css.read_bytes())
guard_hash = h.hexdigest()[:8]
token = f'up-{sha[:12]}-g{guard_hash}'

for p in Path('.').glob('*.html'):
    s = p.read_text()

    # Keep the exact upstream visual CSS/JS. Only swap Google-hosted font files
    # for byte-compatible local copies, which does not alter the design rules.
    s = re.sub(r'\s*<link[^>]+href=["\']https://fonts\.googleapis\.com/[^"\']+["\'][^>]*>\s*', '\n', s)
    s = re.sub(r'\s*<link[^>]+href=["\']https://fonts\.gstatic\.com[^"\']*["\'][^>]*>\s*', '\n', s)
    s = re.sub(r'\s*<link[^>]+rel=["\']preconnect["\'][^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*', '\n', s)

    if 'assets/gravitas.css' in s and 'assets/local-fonts.css' not in s:
        s = re.sub(
            r'(<link[^>]+href=["\']assets/gravitas\.css(?:\?[^"\']*)?["\'][^>]*>)',
            f'<link rel="stylesheet" href="assets/local-fonts.css?v={token}">\n\\1',
            s,
            count=1,
        )

    # Cache-bust the canonical assets without changing their contents.
    s = re.sub(
        r'assets/(gravitas|site|hero|chat|brand)\.(css|js)(?:\?v=[^"\']*)?',
        lambda m: f'assets/{m.group(1)}.{m.group(2)}?v={token}',
        s,
    )
    s = re.sub(
        r'assets/local-fonts\.css(?:\?v=[^"\']*)?',
        f'assets/local-fonts.css?v={token}',
        s,
    )

    # Production bridge contains API/auth behavior only; it does not patch UI.
    if p.name != 'brand.html':
        s = re.sub(r'\s*<script[^>]+src=["\']assets/production-bridge\.js(?:\?v=[^"\']*)?["\'][^>]*></script>\s*', '\n', s)
        s = s.replace('</body>', f'<script src="assets/production-bridge.js?v={token}" defer></script>\n</body>', 1)

    p.write_text(s)

account = Path('account.html')
if account.exists():
    s = account.read_text()
    s = s.replace('minlength="8"', 'minlength="10"')
    s = s.replace('at least eight characters', 'at least ten characters')
    s = s.replace('at least 8 characters', 'at least 10 characters')
    account.write_text(s)
PY

# Production safety + visual parity checks.
test -f assets/production-bridge.js
test -f assets/local-fonts.css
test -f "$MARKER"
grep -q 'assets/production-bridge.js?v=up-' index.html
cmp -s assets/gravitas.css "$UPSTREAM_DIR/assets/gravitas.css"
cmp -s assets/site.css "$UPSTREAM_DIR/assets/site.css"
cmp -s assets/site.js "$UPSTREAM_DIR/assets/site.js"
cmp -s assets/hero.css "$UPSTREAM_DIR/assets/hero.css"
cmp -s assets/hero.js "$UPSTREAM_DIR/assets/hero.js"
cmp -s assets/chat.css "$UPSTREAM_DIR/assets/chat.css"
cmp -s assets/chat.js "$UPSTREAM_DIR/assets/chat.js"
grep -Fq '<span><span class="g-nums">312K</span> subscribers</span>' index.html
grep -Fq '<span><a href="community.html#join">4,100 members</a></span>' index.html

if git diff --quiet && [ -z "$(git status --porcelain --untracked-files=all)" ]; then
  echo 'No repository changes after parity verification.'
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo 'changed=false' >> "$GITHUB_OUTPUT"
    echo "sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

git config user.name 'Gravitas Design Sync'
git config user.email '45485005+hsdarestani@users.noreply.github.com'
git add -- '*.html' assets "$MARKER"
git commit -m "Sync canonical frontend from kiaa-raad/gravitasplus ${UPSTREAM_SHA:0:12}"
git push origin HEAD:main

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo 'changed=true' >> "$GITHUB_OUTPUT"
  echo "sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"
fi

echo "Synchronized canonical Kiarash frontend at $UPSTREAM_SHA"
