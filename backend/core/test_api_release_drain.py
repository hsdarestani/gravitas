"""Exercise the deployed route() with real Nginx and a server-confirmed POST."""
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from unittest import skipUnless
from urllib.request import Request, urlopen

from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[2]
NGINX = shutil.which('nginx')


@skipUnless(NGINX, 'requires the real Nginx binary (installed in reliability CI)')
class ApiReleaseDrainTests(SimpleTestCase):
    def test_route_drains_inflight_save_without_duplicate_or_dropped_requests(self):
        source = (ROOT / 'scripts/reliability/deploy-api-release.sh').read_text()
        body = re.search(r'^route\(\) \{\n(.*?)^\}', source, re.M | re.S).group(0)
        started = threading.Event()
        writes = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'healthy')

            def do_POST(self):
                writes.append(self.rfile.read(int(self.headers['Content-Length'])))
                started.set()
                time.sleep(1.5)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'saved')

        servers = [ThreadingHTTPServer(('127.0.0.1', 0), Handler) for _ in range(2)]
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'nginx.conf'
            pid = root / 'nginx.pid'
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            def configuration(upstream):
                return f'''pid {pid};
error_log {root / 'error.log'};
worker_processes 1;
events {{ worker_connections 128; }}
http {{ access_log off; client_body_temp_path {root / 'body'};
proxy_temp_path {root / 'proxy'}; fastcgi_temp_path {root / 'fastcgi'};
uwsgi_temp_path {root / 'uwsgi'}; scgi_temp_path {root / 'scgi'};
server {{ listen 127.0.0.1:{port}; location / {{
proxy_pass http://127.0.0.1:{upstream}; }} }} }}
'''
            config.write_text(configuration(servers[0].server_port))
            candidate = root / 'candidate.conf'
            candidate.write_text(configuration(servers[1].server_port))
            commands = root / 'bin'; commands.mkdir()
            for name, script in {
                'sudo': '#!/bin/bash\nexec "$@"\n',
                'nginx': '#!/bin/bash\nexec "$REAL_NGINX" -p "$TEST_ROOT/" -c "$NGINX" "$@"\n',
                'systemctl': '''#!/bin/bash
if [ "$1" = show ]; then cat "$TEST_ROOT/nginx.pid";
elif [ "$1" = reload ]; then exec "$REAL_NGINX" -p "$TEST_ROOT/" -c "$NGINX" -s reload;
else exit 1; fi
''',
            }.items():
                path = commands / name; path.write_text(script); path.chmod(0o755)
            env = {**os.environ, 'REAL_NGINX': NGINX, 'TEST_ROOT': str(root),
                   'NGINX': str(config), 'CANDIDATE': str(candidate),
                   'PATH': str(commands) + os.pathsep + os.environ['PATH']}
            subprocess.run([NGINX, '-p', str(root) + '/', '-c', str(config)], check=True)
            stop = threading.Event()
            errors = []
            samples = []
            url = f'http://127.0.0.1:{port}/'
            def monitor():
                while not stop.is_set():
                    try:
                        with urlopen(url, timeout=3) as response:
                            samples.append(response.read())
                    except Exception as error:
                        errors.append(str(error))
                    stop.wait(0.02)
            try:
                threading.Thread(target=monitor, daemon=True).start()
                with ThreadPoolExecutor() as pool:
                    def save():
                        with urlopen(Request(url, data=b'committed-task'), timeout=8) as response:
                            return response.read()
                    saving = pool.submit(save)
                    self.assertTrue(started.wait(5), 'save never reached original upstream')
                    result = subprocess.run(['bash', '-euo', 'pipefail', '-c', body + '\nroute "$CANDIDATE"'],
                                            env=env, capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(saving.result(), b'saved')
                servers[0].shutdown()
                with urlopen(url, timeout=3) as response:
                    self.assertEqual(response.read(), b'healthy')
                self.assertEqual(writes, [b'committed-task'])
                self.assertFalse(errors, errors)
                self.assertGreater(len(samples), 10)
            finally:
                stop.set()
                subprocess.run([NGINX, '-p', str(root) + '/', '-c', str(config), '-s', 'quit'], check=True)
                for server in servers:
                    server.shutdown(); server.server_close()
