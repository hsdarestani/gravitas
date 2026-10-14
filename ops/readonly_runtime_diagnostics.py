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
    return result.stdout[-8_000_000:]

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

def safe_route(path):
    path = path.split('?', 1)[0]
    if path.startswith('/api/platform/nextcloud/notes/'):
        return 'notes-api'
    if path.startswith('/api/platform/projects/'):
        return 'project-api'
    if path.startswith('/api/platform/anchored-comments/'):
        return 'comments-api'
    if path.startswith('/api/operating/task-board/'):
        return 'task-board-api'
    if path.startswith('/api/operating/'):
        return 'operating-api'
    if path.startswith('/api/auth/'):
        return 'auth-api'
    if path.startswith('/api/health/'):
        return 'health-api'
    if path.startswith('/api/'):
        return 'other-api'
    if path.startswith('/workspace'):
        return 'workspace'
    if path.startswith('/nextcloud/'):
        return 'nextcloud'
    return 'public'


def web_status():
    print("=== Nginx responses (tail, aggregate only) ===")
    path = "/var/log/nginx/access.log"
    rows = read_lines(path)
    if not rows:
        rows = run("sudo", "-n", "tail", "-n", "20000", path).splitlines()
    count = collections.Counter()
    codes_by_bucket = collections.Counter()
    error_minute = collections.Counter()
    for line in rows[-20000:]:
        match = re.search(r'"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\s"]+)\s+HTTP/[^"]+"\s+(\d{3})\b', line)
        if not match:
            continue
        _, path, code = match.groups()
        count[code] += 1
        if code.startswith("5"):
            # Never log the original URL or query. Show broad endpoint group.
            group = safe_route(path)
            codes_by_bucket[(group, code)] += 1
            match_time = re.search(r'\[(\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}):\d{2}', line)
            if match_time:
                error_minute[(match_time.group(1), code)] += 1
    print("status_counts", dict(count))
    print("server_errors_by_area", dict((f"{group}:{code}", num) for (group,code),num in codes_by_bucket.items()))
    print("recent_5xx_minutes", [dict(minute=minute, status=code, count=count)
                                  for (minute, code), count in error_minute.most_common(25)])
    log = read_lines("/var/log/nginx/error.log")
    if not log:
        log = run("sudo", "-n", "tail", "-n", "16000", "/var/log/nginx/error.log").splitlines()
    categories = {
        "refused": "connect() failed",
        "closed_upstream": "upstream prematurely closed",
        "upstream_timeout": "upstream timed out",
        "reset": "connection reset by peer",
        "no_upstream": "no live upstreams",
        "too_many_files": "too many open files",
    }
    counts = collections.Counter()
    for row in log[-16000:]:
        low = row.lower()
        for key, needle in categories.items():
            if needle in low:
                counts[key] += 1
    print("nginx_upstream_error_buckets", dict(counts))

def backend():
    print("=== Django/Gunicorn errors (last 8 hours, anonymized) ===")
    log = run("sudo", "-n", "journalctl", "-u", "gravitas-backend", "--since", "8 hours ago", "--no-pager", "-o", "cat")
    if not log:
        log = run("journalctl", "-u", "gravitas-backend", "--since", "8 hours ago", "--no-pager", "-o", "cat")
    errors = collections.Counter()
    locations = collections.Counter()
    generic = collections.Counter()
    for line in log.splitlines()[-18000:]:
        m = re.match(r"^(?:[a-zA-Z_][\w.]*)?(?:[A-Za-z]+Error|Exception|Timeout|OperationalError|IntegrityError|DatabaseError|ProgrammingError):", line.strip())
        if m:
            errors[m.group().split(":", 1)[0][-100:]] += 1
        low = line.lower()
        for label, signature in (
            ('internal_server_error', 'internal server error:'),
            ('gunicorn_worker_timeout', 'worker timeout'),
            ('gunicorn_worker_killed', 'worker was sent sigkill'),
            ('unhandled_traceback', 'traceback (most recent call last)'),
        ):
            if signature in low:
                generic[label] += 1
        file = re.search(r'File "[^"]*/(core|gravitas_backend)/([A-Za-z_0-9/]+\.py)", line (\d+)', line)
        if file:
            locations[(file.group(1), file.group(2)[-110:], file.group(3))] += 1
    print("exception_types", dict(errors.most_common(20)))
    print("server_error_signatures", dict(generic))
    print("traceback_locations", [
        dict(module=a, file=b, line=c, count=n) for (a,b,c),n in locations.most_common(12)
    ])

def nextcloud():
    print("=== Nextcloud health and lock signals ===")
    for name in ("gravitas-nextcloud", "gravitas-nextcloud-redis"):
        value = run("sudo", "-n", "docker", "inspect", "-f", "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}", name)
        print(name, value.strip() or "unknown")
    log = run("sudo", "-n", "docker", "logs", "--since", "90m", "--tail", "8000", "gravitas-nextcloud", timeout=20)
    # Native Nextcloud application errors are ordinarily stored in its
    # private data directory, not Docker stdout. Read it for aggregate
    # diagnostic categories ONLY; never print or upload a full log line.
    native_log = run(
        "sudo", "-n", "docker", "exec", "-u", "www-data", "gravitas-nextcloud",
        "sh", "-c", "tail -n 12000 /var/www/html/data/nextcloud.log 2>/dev/null",
        timeout=20,
    )
    log += "\n" + native_log
    counters = collections.Counter()
    for row in log.splitlines():
        low = row.lower()
        for keyword in ("filelocked", "lockedexception", "could not rename", "423 locked", "412 precondition", "redis connection", "database connection", "503 service unavailable"):
            if keyword in low:
                counters[keyword] += 1
    print("nextcloud_exception_buckets", dict(counters))
    # Nextcloud's locking strategy is a major cause of stuck MOVE/rename
    # operations. Report the NAME of the configured cache adapter, never the
    # redis configuration object (which may contain a password).
    for key in ("memcache.locking", "memcache.local", "memcache.distributed", "filelocking.enabled"):
        output = run("sudo", "-n", "docker", "exec", "-u", "www-data",
                     "gravitas-nextcloud", "php", "occ",
                     "config:system:get", key, timeout=12).strip()
        if key == "filelocking.enabled":
            safe = "disabled" if output in {"0", "false", "False"} else "enabled" if output in {"1", "true", "True"} else "unknown"
        elif "Redis" in output:
            safe = "Redis"
        elif "APCu" in output:
            safe = "APCu"
        elif not output:
            safe = "unconfigured"
        else:
            # Never print arbitrary config contents.
            safe = "configured_other"
        print("nextcloud_config", key, safe)
    # The native Notes API, WebDAV and the filesystem mirror can all be
    # called by different writers. A stale maintenance mode or wrong lock
    # backend is safer to detect than to automatically change.
    maintenance = run("sudo", "-n", "docker", "exec", "-u", "www-data",
                      "gravitas-nextcloud", "php", "occ",
                      "config:system:get", "maintenance", timeout=12).strip()
    print("nextcloud_maintenance", "on" if maintenance in {"1", "true", "True"} else "off_or_unknown")

if __name__ == "__main__":
    print("GraviQuest read-only diagnostics", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))
    health()
    web_status()
    backend()
    nextcloud()
