"""Root-only checkpoint gate for the selected one-off server acceptance plan."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        print('Inspection only: fresh matched backup, isolated restore rehearsal, then selected private-project acceptance.')
        return
    if os.geteuid() != 0:
        parser.error('Apply requires server root')
    root = Path('/var/www/gravitas/ops')
    checkpoint_script = str(root / 'canonical_checkpoint.py')
    completed = subprocess.run(['python3', checkpoint_script, 'backup', '--apply'], check=True, capture_output=True, text=True)
    paths = [line.removeprefix('Checkpoint: ') for line in completed.stdout.splitlines() if line.startswith('Checkpoint: ')]
    if len(paths) != 1:
        raise ValueError('Matched checkpoint identity missing')
    checkpoint = Path(paths[0]).resolve()
    if checkpoint.parent != Path('/var/backups/gravitas-canonical'):
        raise ValueError('Unexpected checkpoint root')
    subprocess.run(['python3', checkpoint_script, 'rehearse', '--checkpoint', str(checkpoint), '--apply'], check=True)
    receipt = json.loads((checkpoint / 'rehearsal.json').read_text())
    if receipt != {'state': 'passed', 'database_fingerprints_match': True, 'native_files_extracted': True}:
        raise ValueError('Native restore rehearsal not verified')
    print('Fresh matched checkpoint and isolated restore passed.', flush=True)
    subprocess.run(['runuser', '-u', 'gravitas', '--', 'bash', '-c',
        'set -e; set -a; . /etc/gravitas/backend.env; set +a; export PYTHONPATH=/opt/gravitas-backend; exec /opt/gravitas-backend/.venv/bin/python /var/www/gravitas/ops/operational_acceptance.py --plan /var/www/gravitas/ops/operational_acceptance.json --apply'], check=True)


if __name__ == '__main__':
    main()
