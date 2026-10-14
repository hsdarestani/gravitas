"""Read-only, privacy-sparing production diagnostics for HTTP 500 and Nextcloud locks.

Runs under a restricted deploy SSH session. Never outputs request paths,
cookies, credentials, payloads, note bodies, filenames or full log lines.
"""
from __future__ import annotations
import collections
import pathlib
import re
import shutil
import subprocess
from datetime import datetime

def run(*cmd, timeout=15):
    if not shutil.which(cmd[0]):
        return ""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout[-2_000_000:]

def read_lines(path, max_bytes=2_000_000):
    try:
        with open(path, "rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - max_bytes))
            return handle.read().decode("utf-8", "replace").splitlines()
    except (OSError, PermissionError):
        return []

def health():
    print("=== Service states ===")
    for name in ("gravitas-backend", "nginx", "postgresql", "redis-server"):
        state = run("systemctl", "is-active", name).strip().splitlines()
        print(name, state[0] if state else "unknown")
    print("=== Capacity ===")
    for cmd in (("uptime",), ("free", "-m"), ("df", "-P", "/")):
        value = run(*cmd).strip()
        if cmd[0] == "uptime" and "load average:" in value:
            value = "load average:" + value.split("load average:", 1)[-1]
        elif cmd[0] == "free":
            value = "\n".join(row for row in value.splitlines() if row.startswith(("Mem:", "Swap:")))
        elif cmd[0] == "df":
            value = value.splitlines()[-1] if value else ""
        print(cmd[0], value[:350] if value else "unavailable")

def web_status():
    print("=== Nginx responses (tail, aggregate only) ===")
    path = "/var/log/nginx/access.log"
    rows = read_lines(path)
    if not rows:
        rows = run("sudo", "-n", "tail", "-n", "20000", path).splitlines()
    count = collections.Counter()
    codes_by_bucket = collections.Counter()
    for line in rows[-20000:]:
        match = re.search(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\s"]+)\s+HTTP/[^"]+"\s+(\d{3})\b', line)
        if not match:
            continue
        _, path, code = match.groups()
        count[code] += 1
        if code.startswith("5"):
            # Never log the original URL or query. Show broad endpoint group.
            path = path.split("?", 1)[0]
            group = "api" if path.startswith("/api/") else "nextcloud" if path.startswith("/nextcloud/") else "workspace" if path.startswith("/workspace") else "public"
            codes_by_bucket[(group, code)] += 1
    print("status_counts", dict(count))
    print("server_errors_by_area", dict((f"{group}:{code}", num) for (group,code),num in codes_by_bucket.items()))

def backend():
    print("=== Django/Gunicorn errors (last 90 min, anonymized) ===")
    log = run("sudo", "-n", "journalctl", "-u", "gravitas-backend", "--since", "90 minutes ago", "--no-pager", "-o", "cat")
    if not log:
        log = run("journalctl", "-u", "gravitas-backend", "--since", "90 minutes ago", "--no-pager", "-o", "cat")
    errors = collections.Counter()
    locations = collections.Counter()
    for line in log.splitlines()[-18000:]:
        m = re.match(r"^(?:[a-zA-Z_][\w.]*)?(?:[A-Za-z]+Error|Exception|Timeout|OperationalError|IntegrityError|DatabaseError|ProgrammingError):", line.strip())
        if m:
            errors[m.group().split(":", 1)[0][-100:]] += 1
        file = re.search(r'File "[^"]*/(core|gravitas_backend)/([A-Za-z_0-9/]+\.py)", line (\d+)', line)
        if file:
            locations[(file.group(1), file.group(2)[-110:], file.group(3))] += 1
    print("exception_types", dict(errors.most_common(20)))
    print("traceback_locations", [
        dict(module=a, file=b, line=c, count=n) for (a,b,c),n in locations.most_common(12)
    ])

def nextcloud():
    print("=== Nextcloud health and lock signals ===")
    for name in ("gravitas-nextcloud", "gravitas-nextcloud-redis"):
        value = run("sudo", "-n", "docker", "inspect", "-f", "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}", name)
        print(name, value.strip() or "unknown")
    log = run("sudo", "-n", "docker", "logs", "--since", "90m", "--tail", "8000", "gravitas-nextcloud", timeout=20)
    counters = collections.Counter()
    for row in log.splitlines():
        low = row.lower()
        for keyword in ("filelocked", "lockedexception", "could not rename", "423 locked", "412 precondition", "redis connection", "database connection", "503 service unavailable"):
            if keyword in low:
                counters[keyword] += 1
    print("nextcloud_exception_buckets", dict(counters))

if __name__ == "__main__":
    print("GraviQuest read-only diagnostics", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))
    health()
    web_status()
    backend()
    nextcloud()
