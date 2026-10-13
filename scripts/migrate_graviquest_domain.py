#!/usr/bin/env python3
"""One-time canonical hostname migration for the Graviquest production site.

Rewrites tracked text URLs and hostnames, but deliberately keeps existing
@gravitasplus.com email identities: DNS migration does not provision an inbox,
SMTP credentials, DKIM, or email-based user identities.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD = "gravitasplus" + ".com"
NEW = "graviquest.com"
HOST = re.compile(r"(?<!@)" + re.escape(OLD), re.IGNORECASE)
SKIP_SEGMENTS = {".git", "node_modules", ".venv", "venv", "__pycache__"}
SKIP_PATHS = {
    "scripts/migrate_graviquest_domain.py",
}
# Applied Django migrations are immutable historical artifacts.
TEXT_EXTS = {
    ".html", ".js", ".mjs", ".css", ".svg", ".json", ".yml", ".yaml",
    ".py", ".sh", ".md", ".xml", ".txt", ".webmanifest", ".toml",
    ".ini", ".conf", ".env", ".example",
}

def tracked_text_files():
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
    for path_bytes in output.split(b"\0"):
        if not path_bytes:
            continue
        relative = path_bytes.decode("utf-8")
        p = Path(relative)
        if relative in SKIP_PATHS or any(x in SKIP_SEGMENTS for x in p.parts):
            continue
        if relative.startswith("backend/core/migrations/"):
            continue
        if p.suffix.lower() not in TEXT_EXTS and p.name not in {"Dockerfile", "Caddyfile"}:
            continue
        yield relative, ROOT / p

def migrate_content(s: str) -> str:
    return HOST.sub(NEW, s)

def ensure_deploy_env_patch():
    file = ROOT / ".github/workflows/deploy.yml"
    contents = file.read_bytes().decode("utf-8")
    marker = '          if [ -n "$TELEGRAM_TOKEN_B64" ]; then'
    injection = '''          # Migrate only canonical web origins in the persisted production env.
          # Preserve passwords, tokens, email identities and Nextcloud's
          # currently working URL until cloud.graviquest.com is provisioned.
          upsert_secret_env PUBLIC_BASE_URL "https://$DOMAIN"
          upsert_secret_env DJANGO_ALLOWED_HOSTS "$DOMAIN,www.$DOMAIN,127.0.0.1,localhost"
          upsert_secret_env DJANGO_CSRF_TRUSTED_ORIGINS "https://$DOMAIN,https://www.$DOMAIN"
          upsert_secret_env GRAVITAS_OIDC_ISSUER "https://$DOMAIN/api/oidc"

'''
    if "upsert_secret_env GRAVITAS_OIDC_ISSUER" in contents:
        return
    if contents.count(marker) != 1:
        raise RuntimeError("Could not locate unambiguous deploy env patch point")
    file.write_bytes(contents.replace(marker, injection + marker, 1).encode("utf-8"))

def keep_existing_mail_identity():
    settings = ROOT / "backend/gravitas_backend/settings.py"
    text = settings.read_bytes().decode("utf-8")
    # An SMTP login and FROM address require provisioning before changing
    # the mailbox domain. Env overrides remain supported.
    text = text.replace(
        "EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', 'webmaster@graviquest.com')",
        "EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', 'webmaster@" + OLD + "')"
    )
    text = text.replace(
        "DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Gravitas+ <webmaster@" + OLD + ">')",
        "DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Graviquest <webmaster@" + OLD + ">')"
    )
    settings.write_bytes(text.encode("utf-8"))

def audit():
    remaining = []
    for name, path in tracked_text_files():
        try:
            data = path.read_bytes()
            if b"\0" in data:
                continue
            text = data.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if HOST.search(text):
            remaining.append(name)
    if remaining:
        raise RuntimeError(f"Unmigrated hostnames: {remaining}")

def main():
    changed = []
    for name, path in tracked_text_files():
        try:
            original = path.read_bytes()
            if b"\0" in original:
                continue
            text = original.decode("utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        updated = migrate_content(text)
        if updated != text:
            path.write_bytes(updated.encode("utf-8"))
            changed.append(name)

    ensure_deploy_env_patch()
    keep_existing_mail_identity()
    audit()

    required = [
        "backend/gravitas_backend/settings.py",
        ".github/workflows/deploy.yml",
        ".github/workflows/nextcloud.yml",
        ".github/workflows/install-openedx.yml",
        "sitemap.xml", "robots.txt",
    ]
    missing = [x for x in required if x not in changed]
    if missing:
        raise RuntimeError(f"Expected domain changes were missing from: {missing}")
    print(f"Migrated {len(changed)} tracked files from {OLD} to {NEW}:")
    for name in changed:
        print("  " + name)
    print("Preserved historical migrations and existing @old-domain mailbox identities.")

if __name__ == "__main__":
    main()
