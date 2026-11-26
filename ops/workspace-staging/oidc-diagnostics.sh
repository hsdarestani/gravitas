#!/usr/bin/env bash
set -euo pipefail

service=gravitas-workspace-staging
config=/etc/gravitas-workspace-staging
container=$service-nextcloud
test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" = "$service"

docker exec "$container" sh -c 'tail -n 150 /var/www/html/data/nextcloud.log' 2>/dev/null | python3 -c '
import json, re, sys
from collections import Counter
from urllib.parse import urlsplit

matched = Counter()
for line in sys.stdin:
    try:
        row = json.loads(line)
    except ValueError:
        continue
    path = urlsplit(row.get("url", "")).path
    if row.get("app") != "user_oidc" and "user_oidc" not in path:
        continue
    details = (str(row.get("message", "")) + " " + str(row.get("exception", ""))).lower()
    recognized = False
    for label, pattern in {
        "state": r"state|session",
        "token_exchange": r"token endpoint|token exchange|exchange.*token|token request|retrieve.*token|get.*token",
        "signature": r"signature|jwks|signing|jwt|issuer",
        "invalid_client": r"invalid.client|client.secret|unauthorized.client",
        "redirect_uri": r"redirect.uri|redirect.url|redirecturi",
        "missing_user": r"user not found|no user|could not find.*user|account creation|auto.provision|create.*user",
        "local_address": r"local address|local server|host violates|not allowed",
        "tls": r"certificate|tls|ssl|curl error 60",
        "status_403": r"\b403\b",
        "status_404": r"\b404\b",
        "status_500": r"\b500\b",
    }.items():
        if re.search(pattern, details):
            matched[label] += 1
            recognized = True
    if not recognized:
        matched["other_nextcloud_oidc_error"] += 1
print("stage_nextcloud_oidc_log_categories=" + json.dumps(matched, sort_keys=True))
'

docker logs --since=30m --tail=500 "$container" 2>&1 | python3 -c '
import re, sys
from collections import Counter
rows = Counter()
for line in sys.stdin:
    match = re.search(r"\x22(GET|POST) [^ ?]*?/user_oidc/(code|login)(?:[/? ]).*? HTTP/[0-9.]+\x22 ([0-9]{3})", line)
    if match:
        rows[(match[2], match[3])] += 1
for (endpoint, status), count in sorted(rows.items()):
    print(f"stage_nextcloud_request {endpoint} HTTP {status} count={count}")
'
