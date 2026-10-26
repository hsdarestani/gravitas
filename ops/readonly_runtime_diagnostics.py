# Incident task716: gather fresh anonymized 502/worker availability evidence.
# Operational read-only health check requested after intermittent post-deploy 502 responses.
"""Read-only, privacy-sparing production diagnostics for HTTP 500 and Nextcloud locks.
Post-security-hotfix runtime verification: always capture actual running PHP, not CI status.
Independent post-patch inspection 2026-10-22: validate running container after update.

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


def scoped_task_health():
    """Current task deep-link HTTP status breakdown, no URLs or identifying data."""
    print("=== Recent task 726 transport and backend probes ===")
    log = read_lines("/var/log/nginx/access.log", max_bytes=12_000_000)
    if not log:
        log = run("sudo", "-n", "tail", "-n", "50000", "/var/log/nginx/access.log").splitlines()
    codes = collections.Counter()
    hours = collections.Counter()
    pattern = re.compile(r'"GET\s+(/api/operating/(?:task-board/726/|tasks/726/(?:history|comments|attachments|checklist)/))[^"]*\s+HTTP/[^"]+"\s+(\d{3})\b')
    for line in log[-50000:]:
        hit = pattern.search(line)
        if not hit:
            continue
        url, code = hit.groups()
        group = "detail" if "task-board" in url else url.rsplit("/", 2)[-2]
        codes[(group, code)] += 1
        timepart = re.search(r"\[20/Oct/2026:(\d{2}):(\d{2}):\d{2} ", line)
        if timepart:
            hours[(timepart.group(1), group, code)] += 1
    print("task726_codes", dict((f"{a}:{b}", n) for (a,b),n in codes.items()))
    print("task726_codes_by_hour", dict((f"{a}:{b}:{c}", n) for (a,b,c),n in hours.items()))
    commands = (
        ("nginx_unauthenticated",
         ("curl", "-sS", "-o", "/dev/null", "--max-time", "6",
          "-H", "Host: graviquest.com", "-H", "X-Forwarded-Proto: https",
          "-w", "%{http_code} %{time_starttransfer} %{time_total}",
          "http://127.0.0.1/api/operating/task-board/726/")),
        ("backend_unauthenticated",
         ("curl", "-sS", "-o", "/dev/null", "--max-time", "6",
          "-w", "%{http_code} %{time_starttransfer} %{time_total}",
          "http://127.0.0.1:8000/api/operating/task-board/726/")),
    )
    for label, cmd in commands:
        response = run(*cmd, timeout=9).strip()
        safe = re.fullmatch(r"\d{3} \d+\.\d+ \d+\.\d+", response)
        print(label, safe.group(0) if safe else "unavailable")
    status = run("systemctl", "is-active", "gravitas-backend.service").strip()
    print("backend_service", status if status in {"active","inactive","failed"} else "unknown")



def task_performance_snapshot():
    """Bounded, aggregate task transport and PostgreSQL waits; no private payloads."""
    print("=== Task 726 live transport and database waits ===")
    log = read_lines("/var/log/nginx/access.log", max_bytes=16_000_000)
    if not log:
        log = run("sudo", "-n", "tail", "-n", "50000", "/var/log/nginx/access.log").splitlines()
    counts = collections.Counter()
    recent = collections.Counter()
    pattern = re.compile(
        r'"GET\s+(/api/operating/(?:task-board/726/|tasks/726/(?:history|comments|attachments|checklist)/))[^\"]*HTTP/[^"]+"\s+(\d{3})\b'
    )
    for row in log[-50000:]:
        hit = pattern.search(row)
        if not hit:
            continue
        path, status = hit.groups()
        if "mode=preview" in path:
            label = "preview"
        elif "task-board" in path:
            label = "detail"
        else:
            label = next((a for a in ("history", "comments", "attachments", "checklist") if a in path), "other")
        counts[(label, status)] += 1
        date = re.search(r'\[20/Oct/2026:(\d\d):', row)
        if date:
            recent[(date.group(1), label, status)] += 1
    print("task_726_response_counts", sorted((f"{a}:{b}", n) for (a, b), n in counts.items()))
    print("task_726_response_by_hour", sorted((f"{hour}:{a}:{b}", n) for (hour, a, b), n in recent.items()))
    sql = (
        "SELECT COALESCE(state,'none'), COALESCE(wait_event_type,'none'), "
        "COALESCE(wait_event,'none'), COUNT(*), "
        "COALESCE(MAX(EXTRACT(EPOCH FROM now()-query_start))::int,0) "
        "FROM pg_stat_activity WHERE datname=current_database() "
        "GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 20"
    )
    out = run("sudo", "-n", "-u", "postgres", "psql", "-d", "gravitas",
              "-X", "-A", "-t", "-F", "|", "-c", sql, timeout=9)
    valid = []
    for line in out.splitlines():
        cells = line.split("|")
        if len(cells) == 5 and cells[3].isdigit() and cells[4].isdigit():
            valid.append(tuple(cells))
    print("postgres_sessions_by_wait", valid or "unavailable")
    sql2 = (
        "SELECT COUNT(*) FILTER (WHERE NOT granted), COUNT(*) FILTER "
        "(WHERE granted), COUNT(DISTINCT pid) "
        "FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database())"
    )
    out2 = run("sudo", "-n", "-u", "postgres", "psql", "-d", "gravitas",
               "-X", "-A", "-t", "-c", sql2, timeout=9).strip()
    print("postgres_lock_counts", out2 if re.fullmatch(r"\d+\|\d+\|\d+",out2) else "unavailable")
    print("server_clock_utc", datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))



def task_read_endpoint_profile():
    """Profile six REAL Django task readers in bounded SQL read-only mode.

    Only emit anonymous timings, HTTP statuses, query counts and DB time.
    No request bodies, query text, credentials or user identifiers are logged.
    """
    print("=== Live Core task GET endpoint profile (bounded read-only) ===")
    source = r'''import os, time, django, signal
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
django.setup()
from django.db import connection, transaction
from django.test import RequestFactory
from django.contrib.auth import get_user_model
from core.models import WorkspaceMembership
from core.operating_models import OperatingTask
from core import task_board_api as board

class Deadline(Exception):
    pass
def alarm(signum, frame):
    raise Deadline()
signal.signal(signal.SIGALRM, alarm)
try:
    task = OperatingTask.objects.select_related('workspace','owner').get(pk=726)
    membership = WorkspaceMembership.objects.filter(workspace=task.workspace, user=task.owner).first()
    if membership is not None:
        user = task.owner
    else:
        record = WorkspaceMembership.objects.filter(workspace=task.workspace).select_related('user').first()
        user = record.user if record else task.owner
    factory = RequestFactory()
    for name, func, suffix in [
        ("preview", board.task_board_detail, "task-board/726/?mode=preview"),
        ("detail", board.task_board_detail, "task-board/726/"),
        ("history", board.task_history, "tasks/726/history/"),
        ("comments", board.task_comments, "tasks/726/comments/"),
        ("attachments", board.task_attachments, "tasks/726/attachments/"),
        ("checklist", board.task_checklist, "tasks/726/checklist/"),
    ]:
        sep = "&" if "?" in suffix else "?"
        path = "/api/operating/" + suffix + sep + "workspace_id=" + str(task.workspace_id)
        req = factory.get(path)
        req.user = user
        measurement = {"queries": 0, "db_seconds": 0.0, "slowest_ms": 0.0}
        def wrapper(execute, sql, params, many, context):
            start_db = time.monotonic()
            try:
                return execute(sql, params, many, context)
            finally:
                elapsed = time.monotonic() - start_db
                measurement["queries"] += 1
                measurement["db_seconds"] += elapsed
                measurement["slowest_ms"] = max(measurement["slowest_ms"], elapsed * 1000)
        started = time.monotonic()
        result = "unknown"
        signal.alarm(10)
        try:
            with transaction.atomic():
                with connection.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
                    cur.execute("SET LOCAL statement_timeout = '9000ms'")
                with connection.execute_wrapper(wrapper):
                    response = func(req, 726)
                result = str(response.status_code)
        except BaseException as exc:
            result = type(exc).__name__[:60]
        finally:
            signal.alarm(0)
            connection.close()
        print("endpoint_probe", name, "result", result,
              "wall_ms", round((time.monotonic()-started)*1000),
              "sql_count", measurement["queries"],
              "sql_ms", round(measurement["db_seconds"]*1000),
              "sql_max_ms", round(measurement["slowest_ms"]))
except BaseException as exc:
    print("profile_setup_failure", type(exc).__name__[:60])
'''
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", prefix="gravitas-task-read-", dir="/tmp", delete=False) as handle:
        handle.write(source)
        temp = handle.name
    try:
        pathlib.Path(temp).chmod(0o644)
        output = run(
            "sudo", "-n", "-u", "gravitas", "bash", "-c",
            "set -a; . /etc/gravitas/backend.env; set +a; "
            "export PYTHONPATH=/opt/gravitas-backend; "
            "/opt/gravitas-backend/.venv/bin/python " + temp,
            timeout=75,
        )
        for line in output.splitlines():
            if re.fullmatch(
                r"endpoint_probe (preview|detail|history|comments|attachments|checklist) "
                r"result (\d{3}|[A-Za-z]{3,60}) wall_ms \d+ "
                r"sql_count \d+ sql_ms \d+ sql_max_ms \d+", line
            ) or re.fullmatch(r"profile_setup_failure [A-Za-z]{3,60}", line):
                print(line)
        if not output:
            print("endpoint_probe_unavailable")
    finally:
        pathlib.Path(temp).unlink(missing_ok=True)



def task_full_middleware_profile():
    """Measure real Django Client GETs with middleware and ephemeral signed cookie.

    This diagnostic only runs SELECTs inside explicit READ ONLY transactions,
    and emits statuses/timings only. It never stores or logs the cookie.
    """
    print("=== Full Django middleware task 726 latency (read-only) ===")
    src = r'''import os, django, time, signal
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
django.setup()
from django.conf import settings
from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
from django.contrib.sessions.backends.signed_cookies import SessionStore
from django.db import connection, transaction
from django.test import Client, override_settings
from core.operating_models import OperatingTask
from core.models import WorkspaceMembership

class Deadline(Exception):
    pass
def alarm(signum, frame):
    raise Deadline()
signal.signal(signal.SIGALRM, alarm)
try:
    task = OperatingTask.objects.select_related('workspace', 'owner').get(pk=726)
    member = WorkspaceMembership.objects.filter(workspace=task.workspace, user=task.owner).first()
    if member:
        user = task.owner
    else:
        record = WorkspaceMembership.objects.filter(workspace=task.workspace).select_related('user').first()
        user = record.user if record else task.owner
    with override_settings(SESSION_ENGINE='django.contrib.sessions.backends.signed_cookies'):
        session = SessionStore()
        session[SESSION_KEY] = str(user.pk)
        session[BACKEND_SESSION_KEY] = settings.AUTHENTICATION_BACKENDS[0]
        session[HASH_SESSION_KEY] = user.get_session_auth_hash()
        session.save()
        client = Client(HTTP_HOST='graviquest.com')
        client.cookies[settings.SESSION_COOKIE_NAME] = session.session_key
        paths = [
            ('preview', '/api/operating/task-board/726/?mode=preview'),
            ('detail', '/api/operating/task-board/726/'),
            ('history', '/api/operating/tasks/726/history/'),
            ('comments', '/api/operating/tasks/726/comments/'),
            ('attachments', '/api/operating/tasks/726/attachments/'),
            ('checklist', '/api/operating/tasks/726/checklist/'),
            ('calendar_status', '/api/calendar/google/tasks/726/status/'),
        ]
        for label, path in paths:
            signal.alarm(10)
            start = time.monotonic()
            status = 'unknown'
            try:
                with transaction.atomic():
                    with connection.cursor() as cur:
                        cur.execute('SET TRANSACTION READ ONLY')
                        cur.execute("SET LOCAL statement_timeout='9000ms'")
                    response = client.get(path, secure=True)
                    status = str(response.status_code)
            except BaseException as exc:
                status = type(exc).__name__[:55]
            finally:
                signal.alarm(0)
            print('middleware_probe',label,'result',status,'wall_ms',round((time.monotonic()-start)*1000))
except BaseException as exc:
    print('middleware_setup_failure',type(exc).__name__[:55])
'''
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", prefix="gravitas-middle-", dir="/tmp", delete=False) as h:
        h.write(src)
        temp = h.name
    try:
        pathlib.Path(temp).chmod(0o644)
        result = run(
            "sudo", "-n", "-u", "gravitas", "bash", "-c",
            "set -a; . /etc/gravitas/backend.env; set +a; "
            "export PYTHONPATH=/opt/gravitas-backend; "
            "/opt/gravitas-backend/.venv/bin/python " + temp,
            timeout=80,
        )
        found = False
        for row in result.splitlines():
            if re.fullmatch(
                r"middleware_probe (preview|detail|history|comments|attachments|checklist|calendar_status) "
                r"result (\d{3}|[A-Za-z]{3,55}) wall_ms \d+", row
            ) or re.fullmatch(r"middleware_setup_failure [A-Za-z]{3,55}", row):
                found = True
                print(row)
        if not found:
            print("middleware_probe_unavailable")
    finally:
        pathlib.Path(temp).unlink(missing_ok=True)



def project_208_read_panel_profile():
    """Authenticated project 208 GETs through all Django middleware, SELECT-only."""
    print("=== Research project 208 full-middleware read-panel latency ===")
    src = r'''import os, django, time, signal
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
django.setup()
from django.conf import settings
from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
from django.contrib.sessions.backends.signed_cookies import SessionStore
from django.db import connection, transaction
from django.test import Client, override_settings
from core.models import ResearchProject

def deadline(signum, frame):
    raise TimeoutError()
signal.signal(signal.SIGALRM, deadline)
try:
    project = ResearchProject.objects.select_related('owner').get(pk=208)
    user = project.owner
    with override_settings(SESSION_ENGINE='django.contrib.sessions.backends.signed_cookies'):
        session = SessionStore()
        session[SESSION_KEY] = str(user.pk)
        session[BACKEND_SESSION_KEY] = settings.AUTHENTICATION_BACKENDS[0]
        session[HASH_SESSION_KEY] = user.get_session_auth_hash()
        session.save()
        client = Client(HTTP_HOST='graviquest.com')
        client.cookies[settings.SESSION_COOKIE_NAME] = session.session_key
        paths = [
            ('cockpit', '/api/platform/projects/208/cockpit/?read_mode=snapshot'),
            ('discussions', '/api/platform/projects/208/discussions/'),
            ('experiments', '/api/platform/projects/208/experiments/'),
            ('milestones', '/api/platform/projects/208/milestones/'),
            ('tasks', '/api/platform/projects/208/tasks/'),
            ('folders', '/api/platform/projects/208/folders/'),
            ('data_tables', '/api/platform/projects/208/tools/data/tables/'),
            ('tool_status', '/api/platform/projects/208/tools/status/'),
            ('builtin_tools', '/api/platform/projects/208/tools/builtin/'),
            ('external_datasets', '/api/platform/projects/208/tools/external/datasets/'),
        ]
        for label, path in paths:
            start = time.monotonic()
            result = 'unknown'
            signal.alarm(8)
            try:
                with transaction.atomic():
                    with connection.cursor() as cur:
                        cur.execute('SET TRANSACTION READ ONLY')
                        cur.execute("SET LOCAL statement_timeout='7000ms'")
                    response = client.get(path, secure=True)
                    result = str(response.status_code)
            except BaseException as exc:
                result = type(exc).__name__[:55]
            finally:
                signal.alarm(0)
                connection.close()
            print('research208_probe',label,'result',result,
                  'wall_ms',round((time.monotonic()-start)*1000))
except BaseException as exc:
    print('research208_setup_failure',type(exc).__name__[:55])
'''
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", prefix="gravitas-research208-", dir="/tmp", delete=False) as h:
        h.write(src)
        temp = h.name
    try:
        pathlib.Path(temp).chmod(0o644)
        output = run(
            "sudo", "-n", "-u", "gravitas", "bash", "-c",
            "set -a; . /etc/gravitas/backend.env; set +a; "
            "export PYTHONPATH=/opt/gravitas-backend; "
            "/opt/gravitas-backend/.venv/bin/python " + temp,
            timeout=102,
        )
        found = False
        for line in output.splitlines():
            if re.fullmatch(
                r"research208_probe (cockpit|discussions|experiments|milestones|tasks|folders|data_tables|tool_status|builtin_tools|external_datasets) "
                r"result (\d{3}|[A-Za-z]{3,55}) wall_ms \d+", line
            ) or re.fullmatch(r"research208_setup_failure [A-Za-z]{3,55}", line):
                print(line)
                found = True
        if not found:
            print("research208_probe_unavailable")
    finally:
        pathlib.Path(temp).unlink(missing_ok=True)

def php_runtime_security():
    """Read-only PHP runtime inventory; prints no settings, secrets, or paths."""
    print("=== PHP2Shell security inventory (CVE-2026-109618 / CVE-2026-109619) ===")
    image = run(
        "sudo", "-n", "docker", "inspect", "-f", "{{.Config.Image}}",
        "gravitas-nextcloud", timeout=12,
    ).strip()
    print("nextcloud_container_image", image[:220] if image else "unknown")
    php = run(
        "sudo", "-n", "docker", "exec", "gravitas-nextcloud",
        "php", "-r", "echo PHP_VERSION;", timeout=15,
    ).strip()
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", php)
    print("nextcloud_php_version", php if match else "unknown")
    fixed = {(8, 2): 35, (8, 3): 36, (8, 4): 27, (8, 5): 12}
    if match:
        major, minor, micro = map(int, match.groups())
        if (major, minor) in fixed:
            status = "patched_upstream_version" if micro >= fixed[(major, minor)] else "below_upstream_patch_verify_backports"
        elif major < 8 or (major == 8 and minor < 2):
            status = "unsupported_upstream_verify_backports"
        else:
            status = "not_classified"
    else:
        status = "version_unknown"
    print("nextcloud_php2shell_status", status)
    # CLI and web PHP use the same runtime image for this Nextcloud container,
    # but downstream image maintainers can backport fixes without bumping PHP_VERSION.
    host_php = run("php", "-r", "echo PHP_VERSION;", timeout=8).strip()
    print("host_php_version", host_php if re.fullmatch(r"\d+\.\d+\.\d+", host_php) else "not_found")
    workers = run("pgrep", "-fc", "php-fpm", timeout=5).strip()
    print("host_php_fpm_processes", workers if workers.isdecimal() else "unknown")


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
    php_runtime_security()
    health()
    web_status()
    backend()
    scoped_task_health()
    task_performance_snapshot()
    task_read_endpoint_profile()
    task_full_middleware_profile()
    project_208_read_panel_profile()
    telegram_diagnostics()
    nextcloud()
