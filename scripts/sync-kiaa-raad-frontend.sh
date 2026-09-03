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
# literal hero separators, API bridge/cache-busting and other guards if any
# deployment or manual edit has drifted from the expected production markup.
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
python3 - "$UPSTREAM_SHA" <<'PY'
from pathlib import Path
import re
import sys

sha = sys.argv[1]
token = 'up-' + sha[:12]

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

index = Path('index.html')
if index.exists():
    s = index.read_text()

    # Hero stats must use literal separator characters in the DOM. Do not rely
    # on ::before because upstream markup/CSS changes can silently remove them.
    old = re.compile(
        r'<p class="lp-hero__credit">\s*'
        r'<span>New topic monthly</span>\s*'
        r'<span><span class="g-nums">312K</span> subscribers</span>\s*'
        r'<span><a href="community\.html#join">4,100 members</a></span>\s*'
        r'</p>',
        re.S,
    )
    new = '''<p class="lp-hero__credit">
          <span>New topic monthly</span>
          <span><span class="lp-hero__literal-sep" aria-hidden="true">•</span><span class="g-nums">312K</span> subscribers</span>
          <span><span class="lp-hero__literal-sep" aria-hidden="true">•</span><a href="community.html#join">4,100 members</a></span>
        </p>'''
    s, n = old.subn(new, s, count=1)

    # Also normalize a previously-patched block so there is always exactly one
    # literal dot before each of the second and third facts.
    if n == 0 and 'lp-hero__literal-sep' in s:
        patched = re.compile(
            r'<p class="lp-hero__credit">\s*'
            r'<span>New topic monthly</span>\s*'
            r'<span>.*?<span class="g-nums">312K</span> subscribers</span>\s*'
            r'<span>.*?<a href="community\.html#join">4,100 members</a></span>\s*'
            r'</p>',
            re.S,
        )
        s, n = patched.subn(new, s, count=1)

    if n == 0:
        raise SystemExit('Could not locate hero stat row for production separator guard')

    style = '''<style id="production-hero-stat-parity">
.lp-hero__credit { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.lp-hero__credit > span { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; }
.lp-hero__credit > span + span::before { content: none !important; display: none !important; }
.lp-hero__credit .lp-hero__literal-sep { display: inline-block !important; color: var(--g-border-strong); font-size: .65em; line-height: 1; flex: none; opacity: 1; }
.lp-hero__credit a { text-decoration-line: underline; text-underline-offset: .2em; }
</style>'''
    s = re.sub(r'\s*<style id="production-hero-stat-parity">.*?</style>\s*', '\n', s, flags=re.S)
    s = s.replace('</head>', style + '\n</head>', 1)
    index.write_text(s)
PY

# Production safety checks.
test -f assets/production-bridge.js
test -f assets/local-fonts.css
test -f "$MARKER"
grep -q 'assets/production-bridge.js?v=up-' index.html
grep -q 'lp-hero__literal-sep' index.html
grep -q 'production-hero-stat-parity' index.html

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
