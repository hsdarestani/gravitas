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
    print("=== Backend worker and capacity signals ===")
    # Only aggregated process counts and totals: do not report arguments, user
    # IDs, request URLs or secrets.
    worker_ps = run("pgrep", "-fc", "gunicorn.*django.core.wsgi").strip()
    print("gunicorn_processes", worker_ps if worker_ps.isdecimal() else "unknown")
    print("backend_active", run("systemctl", "is-active", "gravitas-backend.service").strip())
    print("backend_recent_restart_count", run("systemctl", "show", "-p", "NRestarts", "--value",
                                              "gravitas-backend.service").strip())
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
    if path.startswith('/api/operating/task-board/') or path.startswith('/api/operating/tasks/'):
        return 'task-board-api'
    if path.startswith('/api/platform/projects/') and '/tasks/' in path:
        return 'research-project-task-api'
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
    print("upstream_bad_gateway", count.get('502', 0),
          "upstream_gateway_timeout", count.get('504', 0))
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

def telegram_diagnostics():
    """Classify Telegram/Pulsar failures without emitting users, chat IDs or text."""
    print("=== Pulsar Telegram routing (privacy-safe) ===")
    live_paths = (
        "/opt/gravitas-backend/core/task_notifications.py",
        "/opt/gravitas-backend/backend/core/task_notifications.py",
    )
    for candidate in live_paths:
        path = pathlib.Path(candidate)
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, PermissionError):
            continue
        print("live_telegram_handler_location", str(path))
        print("live_handler_has_legacy_callback_error",
              "Pulsar could not complete that action. Please try again." in source)
        print("live_handler_has_safe_callback_ack",
              "Telegram callback acknowledgement failed, continuing" in source)
        break
    else:
        print("live_telegram_handler_location", "unavailable")

    log = run("sudo", "-n", "journalctl", "-u", "gravitas-backend",
              "--since", "24 hours ago", "--no-pager", "-o", "cat", timeout=35)
    if not log:
        log = run("journalctl", "-u", "gravitas-backend",
                  "--since", "24 hours ago", "--no-pager", "-o", "cat", timeout=35)
    patterns = {
        "callback_legacy_failure": "Telegram Pulsar callback failed",
        "callback_handler_failure": "Telegram Pulsar callback handler failed",
        "callback_ack_failure": "Telegram callback acknowledgement failed",
        "callback_reply_failure": "Telegram Pulsar callback reply delivery failed",
        "message_failure": "Telegram Pulsar message failed",
        "message_reply_failure": "Could not send Telegram Pulsar error response",
        "unconnected_response_failure": "Could not send unconnected Telegram Pulsar response",
        "work_report_failure": "work report",
        "telegram_transport_error": "telegram_transport_error",
        "telegram_http_error": "telegram_http_",
    }
    errors = collections.Counter()
    for line in log.splitlines()[-50000:]:
        for name, needle in patterns.items():
            if needle.lower() in line.lower():
                errors[name] += 1
    print("telegram_event_error_counts_24h", dict(errors))
    # Nginx statuses for the one fixed route. Never emit client IP, query or payload.
    access = read_lines("/var/log/nginx/access.log")
    if not access:
        access = run("sudo", "-n", "tail", "-n", "20000", "/var/log/nginx/access.log").splitlines()
    webhook_statuses = collections.Counter()
    for line in access[-20000:]:
        m = re.search(r'"POST\\s+(/api/task-notifications/telegram/webhook/)(?:\\?[^\\s"]*)?\\s+HTTP/[^"]+"\\s+(\\d{3})\\b', line)
        if m:
            webhook_statuses[m.group(2)] += 1
    print("telegram_webhook_http_statuses_tail", dict(webhook_statuses))


def task_726_latency_diagnostics():
    """Count request failures and latency for one task; print no user data."""
    print("=== Task card 726 endpoint health (last 90 min) ===")
    raw = read_lines("/var/log/nginx/access.log", max_bytes=12_000_000)
    if not raw:
        raw = run("sudo", "-n", "tail", "-n", "50000", "/var/log/nginx/access.log").splitlines()
    now = datetime.utcnow()
    counts = collections.Counter()
    sampled = collections.defaultdict(list)
    for line in raw[-50000:]:
        mt = re.search(r'\[(\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2}) [+-]\d{4}\]', line)
        if not mt:
            continue
        try:
            at = datetime.strptime(mt.group(1), "%d/%b/%Y:%H:%M:%S")
        except ValueError:
            continue
        if not (0 <= (now - at).total_seconds() <= 5400):
            continue
        m = re.search(r'"GET\s+(/api/operating/(?:task-board/726/|tasks/726/(?:history|comments|attachments|checklist)/))[^"]*\s+HTTP/[^"]+"\s+(\d{3})\b', line)
        if not m:
            continue
        url, code = m.groups()
        bucket = "detail" if "task-board" in url else url.split("/")[-2]
        counts[(bucket, code)] += 1
        values = re.findall(r'\b(\d+\.\d{3})\b', line[mt.end():])
        if values:
            # Nginx optional timing field; do not infer from arbitrary metrics.
            sampled[bucket].append(values[-1])
    print("task726_response_codes", dict((f"{k[0]}_{k[1]}", v) for k,v in counts.items()))
    print("task726_latency_fields_present", {k: len(v) for k,v in sampled.items()})
    status = run("sudo", "-n", "-u", "postgres", "psql", "-X", "-q", "-t", "-A",
                 "-d", "gravitas", "-c", (
                     "BEGIN READ ONLY; "
                     "SELECT state,wait_event_type,COUNT(*) FROM pg_stat_activity "
                     "WHERE datname='gravitas' GROUP BY state,wait_event_type ORDER BY COUNT(*) DESC; "
                     "ROLLBACK;"
                 ), timeout=12)
    normalized = [x for x in status.splitlines() if x.count("|") == 2]
    print("postgres_activity_summary", normalized[:12] if normalized else "unavailable")
    # Request from the server itself avoids the user's network and measures
    # whether Gunicorn can answer an anonymous, health-only probe.
    probe = run("curl", "-s", "-o", "/dev/null", "--connect-timeout", "3",
                "--max-time", "8", "-w", "%{http_code} %{time_starttransfer} %{time_total}",
                "http://127.0.0.1:8000/api/health/", timeout=10).strip()
    m = re.fullmatch(r"(\d{3}) (\d+\.\d+) (\d+\.\d+)", probe)
    print("local_backend_health_probe", m.group(0) if m else "unavailable")


def task_726_view_profile():
    """Time real Django read views in a SQL read-only transaction, no content output."""
    print("=== Task 726 production view timing (read only) ===")
    script = r'''import os, time, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
django.setup()
from django.db import connection, transaction
from django.test import RequestFactory
from django.contrib.auth import get_user_model
from core.operating_models import OperatingTask
from core import task_board_api as board
with transaction.atomic():
    with connection.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
    task = OperatingTask.objects.select_related("workspace").get(pk=726)
    user_id = task.workspace.owner_id or task.owner_id
    user = get_user_model().objects.get(pk=user_id)
    factory = RequestFactory()
    for name, func, suffix in [
        ("preview", board.task_board_detail, "task-board/726/?mode=preview"),
        ("detail", board.task_board_detail, "task-board/726/"),
        ("history", board.task_history, "tasks/726/history/"),
        ("comments", board.task_comments, "tasks/726/comments/"),
        ("attachments", board.task_attachments, "tasks/726/attachments/"),
        ("checklist", board.task_checklist, "tasks/726/checklist/"),
    ]:
        separator = "&" if "?" in suffix else "?"
        request = factory.get("/api/operating/" + suffix + separator + "workspace_id=" + str(task.workspace_id))
        request.user = user
        start = time.monotonic()
        try:
            resp = func(request, 726)
            print("profile", name, "status", resp.status_code, "ms", round((time.monotonic() - start) * 1000))
        except Exception as exc:
            print("profile", name, "exception", type(exc).__name__, "ms", round((time.monotonic() - start) * 1000))
'''
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", prefix="gravitas-profile-", dir="/tmp", delete=False) as handle:
        handle.write(script)
        probe_path = handle.name
    try:
        pathlib.Path(probe_path).chmod(0o644)
        result = run(
            "sudo", "-n", "-u", "gravitas", "bash", "-c",
            "set -a; . /etc/gravitas/backend.env; set +a; "
            "export PYTHONPATH=/opt/gravitas-backend; "
            "/opt/gravitas-backend/.venv/bin/python " + probe_path,
            timeout=40,
        )
        print("profile_result", result[-2500:] if result else "unavailable")
    finally:
        pathlib.Path(probe_path).unlink(missing_ok=True)


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
    task_726_latency_diagnostics()
    task_726_view_profile()
    telegram_diagnostics()
    nextcloud()
