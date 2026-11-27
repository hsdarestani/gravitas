"""Run a loopback release target with preinstalled artifacts and a durable receipt log."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile


TARGET = 'isolated-production-rehearsal'
SHA = re.compile(r'[0-9a-f]{40}')
KEY = re.compile(r'[1-9][0-9]*\.[1-9][0-9]*\.(deploy|rollback)')


class Conflict(ValueError):
    pass


class Target:
    def __init__(self, root, initial):
        self.root = Path(root).resolve()
        if (self.root / '.isolated-release-target').read_text().strip() != TARGET:
            raise ValueError('dedicated_target_required')
        self.state = self.root / 'state.json'
        if not self.state.exists():
            self.save({'revision': initial, 'digest': self.digest(initial), 'receipts': {}})

    def artifact(self, sha):
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError('invalid_revision')
        directory = self.root / 'artifacts' / sha
        index = directory / 'index.html'
        if index.resolve() != index or not index.is_file():
            raise ValueError('artifact_not_installed')
        return index.read_bytes()

    def digest(self, sha):
        return hashlib.sha256(self.artifact(sha)).hexdigest()

    def snapshot(self):
        row = json.loads(self.state.read_text())
        if not hmac.compare_digest(row['digest'], self.digest(row['revision'])):
            raise ValueError('artifact_digest_changed')
        return row

    def save(self, row):
        with NamedTemporaryFile(mode='w', dir=self.root, delete=False) as pending:
            path = Path(pending.name)
            try:
                json.dump(row, pending)
                pending.flush()
                os.fsync(pending.fileno())
                os.replace(path, self.state)
                descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            finally:
                path.unlink(missing_ok=True)

    def execute(self, request):
        if not isinstance(request, dict) or set(request) != {'operation', 'key', 'expected', 'revision'}:
            raise ValueError('invalid_request')
        operation, key = request['operation'], request['key']
        if (operation not in ('deploy', 'rollback') or not isinstance(key, str) or not KEY.fullmatch(key)
                or not key.endswith('.' + operation)):
            raise ValueError('invalid_operation')
        expected, revision = request['expected'], request['revision']
        if (not isinstance(expected, str) or not SHA.fullmatch(expected) or expected == revision):
            raise ValueError('invalid_release_base')
        row = self.snapshot()
        if previous := row['receipts'].get(key):
            if previous['request'] != request or row['revision'] != revision:
                raise Conflict('receipt_conflict')
            return previous['result']
        if row['revision'] != expected:
            raise Conflict('stale_target_revision')
        prefix = key.rsplit('.', 1)[0]
        if operation == 'rollback':
            deploy = row['receipts'].get(prefix + '.deploy', {}).get('request', {})
            if deploy.get('revision') != expected or deploy.get('expected') != revision:
                raise Conflict('rollback_has_no_matching_deploy')
        receipt = dict(target=TARGET, operation=operation, key=key, revision=revision, previous=expected,
                       digest=self.digest(revision))
        row.update(revision=revision, digest=receipt['digest'])
        row['receipts'][key] = {'request': request, 'result': receipt}
        self.save(row)
        return receipt


def create_server(target, token, port):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token):
        raise ValueError('dedicated_target_token_required')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def response(self, status, content, kind='application/json'):
            if isinstance(content, dict):
                content = json.dumps(content).encode()
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(content)

        def authorized(self):
            supplied = self.headers.get('Authorization', '').encode('utf-8')
            if hmac.compare_digest(supplied, ('Bearer ' + token).encode()):
                return True
            self.response(403, {'error': 'target_forbidden'})
            return False

        def do_GET(self):
            if not self.authorized():
                return
            try:
                row = target.snapshot()
                if self.path == '/health':
                    self.response(200, dict(target=TARGET, revision=row['revision'], digest=row['digest']))
                elif self.path == '/':
                    self.response(200, target.artifact(row['revision']), 'text/html; charset=utf-8')
                else:
                    self.response(404, {'error': 'target_not_found'})
            except (ValueError, OSError):
                self.response(503, {'error': 'target_unhealthy'})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != '/release':
                self.response(404, {'error': 'target_not_found'})
                return
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length < 4096:
                    raise ValueError('invalid_request_size')
                result = target.execute(json.loads(self.rfile.read(length)))
            except Conflict as error:
                self.response(409, {'error': str(error)})
            except (ValueError, OSError):
                self.response(400, {'error': 'target_request_invalid'})
            else:
                self.response(200, result)

    return HTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    directory, initial = sys.argv[1:]
    with create_server(Target(directory, initial), os.environ['GQ_ISOLATED_RELEASE_TOKEN'], 18120) as server:
        server.serve_forever()
