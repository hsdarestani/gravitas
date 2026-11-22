#!/usr/bin/env bash
# Verify current GraviQuest canonical/public surface after deployment.
# Temporary prelaunch noindex headers are managed in a separate workflow.
set -euo pipefail
BASE="${1:-https://graviquest.com}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fetch() {
  curl -4 -fsSL --connect-timeout 8 --max-time 35 --retry 3 --retry-delay 2 \
    "$BASE/$1" > "$TMP/$2"
}
need() {
  if ! grep -Fq -- "$1" "$TMP/$2"; then
    echo "::error::SEO verification failed: $3 (in $2)" >&2
    exit 1
  fi
}
absent() {
  if grep -Fq -- "$1" "$TMP/$2"; then
    echo "::error::SEO verification failed: $3 (in $2)" >&2
    exit 1
  fi
}
fetch "" home.html
fetch "topics" topics.html
fetch "topic-answer-that-looked-right" topic.html
fetch "robots.txt" robots.txt
fetch "sitemap.xml" sitemap.xml

need '<link rel="canonical" href="https://graviquest.com/">' home.html 'Homepage canonical URL'
need '<meta name="description"' home.html 'Homepage meta description'
need '<link rel="canonical" href="https://graviquest.com/topics">' topics.html 'Topics canonical target'
need '<title>Topics' topics.html 'Current topics page'

need 'Sitemap: https://graviquest.com/sitemap.xml' robots.txt 'Sitemap declaration'
need 'Disallow: /admin/' robots.txt 'Admin robots exclusion'
need 'Disallow: /api/' robots.txt 'API robots exclusion'
need '<loc>https://graviquest.com/</loc>' sitemap.xml 'Homepage in sitemap'
need '<loc>https://graviquest.com/topics</loc>' sitemap.xml 'Topics in sitemap'
absent 'https://graviquest.com/dossiers' sitemap.xml 'Retired route must not be indexed'
absent '.html</loc>' sitemap.xml 'Canonical sitemap URL must be extensionless'
absent '/admin/' sitemap.xml 'Admin path must not be published'
absent '/api/' sitemap.xml 'API path must not be published'
absent '/account' sitemap.xml 'Account path must not be published'
absent 'fonts.googleapis.com' home.html 'External font leak'
absent 'fonts.gstatic.com' home.html 'External font leak'
absent '312K' home.html 'Unverified audience claim'
absent '418K views' home.html 'Unverified audience claim'
# The old .html URL must redirect, rather than silently serve a duplicate.
legacy_headers="$(curl -4 -sSI --connect-timeout 8 --max-time 35 "$BASE/topics.html" | tr -d '\\r')"
if ! printf '%s\\n' "$legacy_headers" | grep -Eq '^HTTP/[^ ]+ 301'; then
  echo "::error::Legacy Topics must return HTTP 301" >&2; exit 1
fi
if ! printf '%s\\n' "$legacy_headers" | grep -Eiq '^location: (https?://[^/]+)?/topics([?[:space:]]|$)'; then
  echo "::error::Legacy Topics must redirect to /topics" >&2; exit 1
fi
echo 'GraviQuest current canonical and privacy SEO checks passed'
