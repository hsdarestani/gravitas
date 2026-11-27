"""Validate immutable release evidence emitted by the reviewed workflows."""
import json
import re
import sys
from pathlib import Path


CI = '.github/workflows/platform-ci.yml'
STAGING = '.github/workflows/platform-staging.yml'


def exact_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('an immutable 40-character Git commit is required')
    return value


def approved_environment(data):
    rules = data.get('protection_rules', [])
    reviewers = next((r for r in rules if r.get('type') == 'required_reviewers'), {})
    if not reviewers.get('reviewers') or reviewers.get('prevent_self_review') is not True:
        raise ValueError('the GitHub environment requires human reviewers and prevent self-review')
    policy = data.get('deployment_branch_policy') or {}
    if not (policy.get('protected_branches') or policy.get('custom_branch_policies')):
        raise ValueError('the GitHub environment requires deployment branch protection')


def verified_run(data, repo, path, revision=None):
    if any((
        data.get('repository', {}).get('full_name') != repo,
        data.get('head_repository', {}).get('full_name') != repo,
        data.get('path', '').split('@')[0] != path,
        data.get('status') != 'completed',
        data.get('conclusion') != 'success',
    )):
        raise ValueError('wrong repository, workflow or unsuccessful validation')
    if revision is not None and data.get('head_sha') != revision:
        raise ValueError('CI did not test the selected commit')


def acceptance(data, revision, run_id):
    exact_sha(revision)
    if (data.get('revision') != revision or str(data.get('run_id')) != run_id
            or data.get('operation') != 'accept' or data.get('environment') != 'staging-final-approval'
            or data.get('status') != 'accepted'):
        raise ValueError('staging evidence does not accept this release revision')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,119}', data.get('qa', '')):
        raise ValueError('staging acceptance is missing a QA record')


def main(cmd, first, *args):
    data = json.loads(Path(first).read_text())
    if cmd == 'environment':
        approved_environment(data)
    elif cmd == 'ci':
        verified_run(data, args[0], CI, exact_sha(args[1]))
    elif cmd == 'staging':
        verified_run(data, args[0], STAGING)
        if data.get('event') != 'workflow_dispatch' or data.get('head_branch') != 'main':
            raise ValueError('staging approval must come from the reviewed main workflow')
    elif cmd == 'acceptance':
        acceptance(data, *args)
    else:
        raise ValueError('unknown release check')


if __name__ == '__main__':
    try:
        main(*sys.argv[1:])
    except (ValueError, KeyError, TypeError) as exc:
        raise SystemExit(str(exc)) from None
