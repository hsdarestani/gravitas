"""Host-shared QA admission control; no application/runtime billing changes.

Reservations survive failed jobs and are never refunded. The rolling 24h limit
is shared by candidate preflight and post-deployment browser QA, across commits,
retries and UTC resets. Only the existing free Cloudflare model is permitted.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import argparse
import fcntl
import json
import os
from pathlib import Path
import time

MAX_MODEL_REQUESTS = 3  # one tiny preflight + two real public/Forum answers
WINDOW = 86400
FREE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
# Last authoritative provider error, from run 44526164165. Do not poll it again.
KNOWN_RESET = datetime(2026, 11, 20, tzinfo=timezone.utc).timestamp()


class BudgetStopped(RuntimeError):
    pass


class Budget:
    def __init__(self, directory, clock=time.time):
        self.directory = Path(directory)
        self.clock = clock

    @contextmanager
    def state(self):
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (self.directory / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = self.directory / 'state.json'
            state = json.loads(path.read_text()) if path.exists() else {
                'blocked_until': KNOWN_RESET, 'requests': [], 'preflight': None,
            }
            state['requests'] = [r for r in state['requests'] if r['at'] > self.clock() - WINDOW]
            try:
                yield state
            finally:
                temporary = path.with_suffix('.tmp')
                temporary.write_text(json.dumps(state, indent=2))
                os.chmod(temporary, 0o600)
                temporary.replace(path)

    def admit(self, *, count=1, purpose, fingerprint, model=FREE_MODEL, production=False):
        with self.state() as state:
            now = self.clock()
            if model != FREE_MODEL:
                raise BudgetStopped('Unverified model/configuration; no provider or billing switch allowed')
            if now < state.get('blocked_until', 0):
                raise BudgetStopped('Cloudflare 4006: free allocation exhausted; next documented reset ' +
                                    datetime.fromtimestamp(state['blocked_until'], timezone.utc).isoformat())
            if not isinstance(count, int) or not 1 <= count <= 2:
                raise BudgetStopped('Invalid model request reservation')
            if len(state['requests']) + count > MAX_MODEL_REQUESTS:
                raise BudgetStopped('Shared rolling 24h QA budget exhausted (3 model calls, including failures)')
            if production:
                preflight = state.get('preflight') or {}
                if preflight.get('fingerprint') != fingerprint or now - preflight.get('at', 0) > 7200:
                    raise BudgetStopped('A matching successful real preflight within two hours is required')
            state['requests'].extend({'at': now, 'purpose': purpose, 'fingerprint': fingerprint}
                                     for _ in range(count))
            return {'reserved_model_calls': count, 'rolling_24h_model_calls': len(state['requests'])}

    def block(self):
        with self.state() as state:
            # Stop ALL QA until at least the next documented UTC reset. No retry.
            state['blocked_until'] = (int(self.clock()) // WINDOW + 1) * WINDOW
            state['preflight'] = None

    def passed(self, fingerprint):
        with self.state() as state:
            state['preflight'] = {'fingerprint': fingerprint, 'at': self.clock()}

    def recent_preflight(self, fingerprint):
        with self.state() as state:
            record = state.get('preflight') or {}
            return (self.clock() >= state.get('blocked_until', 0)
                    and record.get('fingerprint') == fingerprint
                    and self.clock() - record.get('at', 0) <= 7200)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ledger', required=True)
    parser.add_argument('--fingerprint', required=True)
    parser.add_argument('--reserve-production', action='store_true')
    parser.add_argument('--block', action='store_true')
    args = parser.parse_args()
    if args.block:
        Budget(args.ledger).block()
        raise SystemExit(0)
    if not args.reserve_production:
        parser.error('Only an explicit production reservation is supported')
    try:
        print(json.dumps(Budget(args.ledger).admit(count=2, purpose='production-browser',
                         fingerprint=args.fingerprint, production=True)))
    except BudgetStopped as exc:
        raise SystemExit(str(exc))
