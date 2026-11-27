#!/usr/bin/env python3
"""Inventory GitHub workflow privileges and fail when a legacy credential path grows."""
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
BASELINE = Path(__file__).with_name('legacy-production-workflows.txt')
LEGACY = re.compile(r'\bsecrets\.(?:DEPLOY_|FORUM_|CLOUDFLARE_|PRODUCTION_)')
EXTERNAL = re.compile(
    r'ssh(?:-keyscan)?\b|\b(?:scp|rsync|docker|cloudflared|curl)\b|'
    r'\b(?:write|deployments):\s*(?:write|true)\b|uses:\s*[^\s]*(?:publish|deploy|upload)'
)


def audit():
    workflows = sorted((ROOT / '.github' / 'workflows').glob('*.y*ml'))
    legacy = set()
    for path in workflows:
        body = path.read_text()
        if LEGACY.search(body):
            legacy.add(path.name)
            kind = 'privileged configuration'
        elif EXTERNAL.search(body):
            kind = 'network or delivery tooling'
        else:
            kind = 'local validation or metadata'
        print(f'{path.name}\t{kind}')
    allowed = {line.strip() for line in BASELINE.read_text().splitlines() if line.strip()}
    new = sorted(legacy - allowed)
    if new:
        print('Unreviewed production credential paths: ' + ', '.join(new), file=sys.stderr)
        return 1
    print(f'{len(workflows)} workflows inventoried; {len(legacy)} with legacy/production-specific credential references.')
    return 0


if __name__ == '__main__':
    raise SystemExit(audit())
