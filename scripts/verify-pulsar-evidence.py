"""Reuse real successful model evidence ONLY while tested application bytes match."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify(root=ROOT):
    manifest = json.loads((root / 'qa/pulsar/evidence.json').read_text())
    for name, expected in manifest['sha256'].items():
        actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'Tested application changed: {name}. Existing model evidence cannot certify it.')
    artifact = root / 'qa/pulsar/published-conversations.json'
    if hashlib.sha256(artifact.read_bytes()).hexdigest() != manifest['report_sha256']:
        raise ValueError('Recorded successful model evidence was modified')
    report = json.loads(artifact.read_text())
    rows = report['conversations']
    if report['failures'] or len(rows) != 42:
        raise ValueError('Expected 42 successful original conversations')
    if any(row.get('automated_issues') or row.get('provider') == 'fallback' or row.get('status') != 200 for row in rows):
        raise ValueError('Unsuccessful conversation in recorded evidence')
    fingerprint = hashlib.sha256(json.dumps(manifest['sha256'], sort_keys=True).encode()).hexdigest()
    return manifest, report, fingerprint


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    parser.add_argument('--fingerprint-only', action='store_true')
    args = parser.parse_args()
    manifest, report, fingerprint = verify()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(fingerprint if args.fingerprint_only else json.dumps({
        'reused_successful_conversations': len(report['conversations']),
        'original_run': manifest['run_id'], 'fingerprint': fingerprint,
        'new_model_requests': 0, 'production_verified': False,
    }))
