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
# Production-only normalization below is intentionally self-healing: it repairs
# API bridge/cache-busting and other production guards if any deployment or
# manual edit has drifted from the expected production markup.
if [ "$PREVIOUS" = "$UPSTREAM_SHA" ]; then
  echo 'No Kiarash update detected; running production normalization anyway.'
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

# Artwork is design-owned and safe to mirror wholesale.
rm -rf assets/thumbnails
if [ -d "$UPSTREAM_DIR/assets/thumbnails" ]; then
  mkdir -p assets
  cp -a "$UPSTREAM_DIR/assets/thumbnails" assets/thumbnails
fi

printf '%s\n' "$UPSTREAM_SHA" > "$MARKER"

# Re-apply production-only integration guards after Kiarash's visual files land.
# Do not override Kiarash's hero markup or hero CSS here: design-owned sections
# must remain byte-for-byte equivalent to upstream whenever possible.
python3 - "$UPSTREAM_SHA" "$UPSTREAM_DIR" <<'PY'
from pathlib import Path
import hashlib
import re
import sys

sha = sys.argv[1]
upstream_dir = Path(sys.argv[2])

# Remove the obsolete hero separator override introduced by an earlier
# production-parity experiment. Kiarash's canonical hero.css already owns the
# separators; duplicating that behavior caused the stat row to drift after load.
local_css = Path('assets/local-fonts.css')
if local_css.exists():
    css = local_css.read_text()
    css = re.sub(
        r'\n?/\* Hero fact separators\..*?\n\.lp-hero__sep \{.*?\n\}\n',
        '\n',
        css,
        count=1,
        flags=re.S,
    )
    local_css.write_text(css)

# Cache keys must change when either the sync guard or production-only CSS
# changes. This prevents a correct deployment from still rendering stale CSS.
h = hashlib.sha256()
h.update(Path('scripts/sync-kiaa-raad-frontend.sh').read_bytes())
if local_css.exists():
    h.update(local_css.read_bytes())
guard_hash = h.hexdigest()[:8]
token = f'up-{sha[:12]}-g{guard_hash}'

for p in Path('.').glob('*.html'):
    s = p.read_text()

    s = re.sub(r'\s*<link[^>]+href=["\']assets/upstream-[^"\']+\.css(?:\?[^"\']*)?["\'][^>]*>\s*', '\n', s)
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

# Hero is design-owned. Always restore the complete hero stat row from the
# current upstream index instead of reconstructing it locally.
index = Path('index.html')
upstream_index = upstream_dir / 'index.html'
if index.exists() and upstream_index.exists():
    row = re.compile(r'<p class="lp-hero__credit">.*?</p>', re.S)
    upstream_match = row.search(upstream_index.read_text())
    if not upstream_match:
        raise SystemExit('Could not locate upstream hero stat row')

    s = index.read_text()
    s, n = row.subn(upstream_match.group(0), s, count=1)
    if n == 0:
        raise SystemExit('Could not locate production hero stat row')

    # Remove obsolete inline parity experiments if an old deployment left one.
    s = re.sub(r'\s*<style id="production-hero-stat-parity">.*?</style>\s*', '\n', s, flags=re.S)
    index.write_text(s)
PY

# Production safety checks.
test -f assets/production-bridge.js
test -f assets/local-fonts.css
test -f "$MARKER"
grep -q 'assets/production-bridge.js?v=up-' index.html
grep -Fq '<span><span class="g-nums">312K</span> subscribers</span>' index.html
grep -Fq '<span><a href="community.html#join">4,100 members</a></span>' index.html
! grep -Fq 'lp-hero__sep' index.html
! grep -Fq '.lp-hero__sep' assets/local-fonts.css
grep -Fq '.lp-hero__credit > span + span::before' assets/hero.css

if git diff --quiet && [ -z "$(git status --porcelain --untracked-files=all)" ]; then
  echo 'No repository changes after normalization.'
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo 'changed=false' >> "$GITHUB_OUTPUT"
    echo "sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi

git config user.name 'Gravitas Design Sync'
git config user.email '45485005+hsdarestani@users.noreply.github.com'
git add -- '*.html' assets "$MARKER"
git commit -m "Sync frontend from kiaa-raad/gravitasplus ${UPSTREAM_SHA:0:12}"
git push origin HEAD:main

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo 'changed=true' >> "$GITHUB_OUTPUT"
  echo "sha=$UPSTREAM_SHA" >> "$GITHUB_OUTPUT"
fi

echo "Synchronized Kiarash frontend at $UPSTREAM_SHA"
