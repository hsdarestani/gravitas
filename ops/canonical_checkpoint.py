#!/usr/bin/env python3
"""Matched native Gravitas/Nextcloud checkpoint for the checked-in Strato stack.

Default is inspection only. Apply runs on the server as root. Never logs secrets.
Both databases and complete native Nextcloud volume are retained together; this
preserves Nextcloud IDs/ACLs, not just DAV content. Restore takes a safety backup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import uuid

BASE = Path('/var/backups/gravitas-canonical')
SOURCES = {'site.tar': Path('/var/www/gravitas'), 'backend.tar': Path('/opt/gravitas-backend'), 'config.tar': Path('/etc/gravitas')}
FILES = (*SOURCES, 'nextcloud.tar', 'gravitas.dump', 'nextcloud.dump')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args):
    return run(args, capture_output=True, text=True).stdout.strip()


def save_json(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush(); os.fsync(handle.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def validate_tar(path):
    # Preserve native symlinks (including venv Python), but never extract a
    # later member through a symlink or an out-of-root hardlink/path.
    with tarfile.open(path) as archive:
        members = archive.getmembers()
        links = {str(PurePosixPath(m.name)) for m in members if m.issym()}
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or member.isdev() or member.isfifo():
                raise ValueError('Unsafe checkpoint archive member')
            if any(str(parent) in links for parent in name.parents):
                raise ValueError('Checkpoint writes through a symlink')
            if member.islnk() and (PurePosixPath(member.linkname).is_absolute() or '..' in PurePosixPath(member.linkname).parts):
                raise ValueError('Unsafe checkpoint hardlink')


def verify(directory):
    directory = directory.resolve(strict=True)
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('schema') != 1 or manifest.get('state') != 'complete' or set(manifest.get('files', {})) != set(FILES):
        raise ValueError('Incomplete checkpoint')
    for name in FILES:
        path = directory / name
        if not path.is_file() or path.is_symlink() or digest(path) != manifest['files'][name]['sha256']:
            raise ValueError('Checkpoint integrity failed: ' + name)
        if name.endswith('.tar'):
            validate_tar(path)
        else:
            with path.open('rb') as handle:
                if handle.read(5) != b'PGDMP':
                    raise ValueError('Invalid PostgreSQL archive')
    return manifest


def volume_path():
    path = Path(output(['docker', 'volume', 'inspect', 'gravitas_nextcloud_html', '--format', '{{.Mountpoint}}']))
    if not path.is_dir() or path.is_symlink():
        raise ValueError('Native Nextcloud volume not found')
    return path


def images():
    return {name: output(['docker', 'inspect', name, '--format', '{{.Image}}'])
            for name in ('gravitas-nextcloud', 'gravitas-nextcloud-db')}


def database_prefix(native):
    return (['docker', 'exec', '-i', 'gravitas-nextcloud-db'], ['-U', 'nextcloud']) if native else (['sudo', '-u', 'postgres'], [])


def database_fingerprint(db, native=False):
    prefix, flags = database_prefix(native)
    tables = json.loads(output(prefix + ['psql', *flags, '-At', '-d', db, '-c',
        "SELECT coalesce(json_agg(tablename ORDER BY tablename), '[]') FROM pg_tables WHERE schemaname = 'public';"]))
    result = {}
    for table in tables:
        identifier = '"' + table.replace('"', '""') + '"'
        # Deterministic table content hashes retain native IDs, relations, ACLs
        # and filecache metadata without writing row values to logs/manifests.
        sql = f"SET TIME ZONE 'UTC'; SELECT json_build_object('rows', count(*), 'hash', md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), ''))) FROM public.{identifier} t;"
        result[table] = json.loads(output(prefix + ['psql', *flags, '-qAt', '-d', db, '-c', sql]))
    return result


def active_units():
    units = json.loads(output(['systemctl', 'list-units', '--state=active', '--all', '--output=json']))
    return sorted(u['unit'] for u in units if u['unit'].startswith('gravitas-') and u['unit'].endswith(('.service', '.timer')))


def pause():
    status = json.loads(output(['docker', 'exec', '-u', 'www-data', 'gravitas-nextcloud', 'php', 'occ', 'status', '--output=json']))
    if not status.get('installed') or status.get('needsDbUpgrade'):
        raise ValueError('Nextcloud must be installed and schema-compatible before checkpointing')
    state = {'units': active_units(), 'maintenance': status['maintenance'], 'nextcloud_version': status['version']}
    # Persist runtime state before stopping anything; inspect/recover uses this
    # file after an interrupted process instead of guessing which units ran.
    save_json(BASE / 'runtime.json', state)
    for unit in sorted(state['units'], key=lambda name: not name.endswith('.timer')):
        run(['systemctl', 'stop', unit])
    run(['docker', 'exec', '-u', 'www-data', 'gravitas-nextcloud', 'php', 'occ', 'maintenance:mode', '--on'], stdout=subprocess.DEVNULL)
    run(['docker', 'stop', 'gravitas-nextcloud'], stdout=subprocess.DEVNULL)
    return state


def resume(state):
    run(['docker', 'start', 'gravitas-nextcloud'], stdout=subprocess.DEVNULL)
    # No requests enter the app while it is still in maintenance mode.
    run(['docker', 'exec', '-u', 'www-data', 'gravitas-nextcloud', 'php', 'occ', 'maintenance:mode', '--on' if state['maintenance'] else '--off'], stdout=subprocess.DEVNULL)
    for unit in sorted(state['units'], key=lambda name: name.endswith('.timer')):
        run(['systemctl', 'start', unit])


def capture(native_path, runtime):
    directory = BASE / str(uuid.uuid4())
    directory.mkdir(mode=0o700)
    manifest = {'schema': 1, 'state': 'pending', 'files': {}, 'runtime': runtime, 'images': images(),
                'databases': {'gravitas': database_fingerprint('gravitas'), 'nextcloud': database_fingerprint('nextcloud', True)}}
    save_json(directory / 'manifest.json', manifest)
    for name, source in {**SOURCES, 'nextcloud.tar': native_path}.items():
        if not source.is_dir() or source.is_symlink():
            raise ValueError('Checkpoint source missing: ' + name)
        run(['tar', '--acls', '--xattrs', '--numeric-owner', '-cpf', str(directory / name), '-C', str(source), '.'])
    for name, command in [
        ('gravitas.dump', ['sudo', '-u', 'postgres', 'pg_dump', '-Fc', 'gravitas']),
        ('nextcloud.dump', ['docker', 'exec', 'gravitas-nextcloud-db', 'pg_dump', '-U', 'nextcloud', '-Fc', 'nextcloud']),
    ]:
        with (directory / name).open('wb') as handle:
            run(command, stdout=handle)
    for name in FILES:
        path = directory / name
        os.chmod(path, 0o600)
        with path.open('rb') as handle:
            os.fsync(handle.fileno())
        manifest['files'][name] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    manifest['state'] = 'complete'
    save_json(directory / 'manifest.json', manifest)
    verify(directory)
    return directory


def rehearse(directory):
    """Restore into isolated databases/private trees; never exchange production."""
    manifest = verify(directory)
    if not manifest.get('databases'):
        raise ValueError('Checkpoint lacks reference database fingerprints')
    rehearsal = BASE / ('rehearsal-' + str(uuid.uuid4()))
    rehearsal.mkdir(mode=0o700)
    databases = []
    try:
        for name in (*SOURCES, 'nextcloud.tar'):
            stage = rehearsal / name.removesuffix('.tar')
            stage.mkdir(mode=0o700)
            run(['tar', '--acls', '--xattrs', '--numeric-owner', '-xpf', str(directory / name), '-C', str(stage)])
        for name, native in [('gravitas', False), ('nextcloud', True)]:
            prefix, flags = database_prefix(native)
            staging_db = name + '_rehearsal_' + uuid.uuid4().hex[:16]
            run(prefix + ['createdb', *flags, '-O', name, staging_db])
            databases.append((prefix, flags, staging_db))
            with (directory / (name + '.dump')).open('rb') as handle:
                run(prefix + ['pg_restore', *flags, '--single-transaction', '-d', staging_db], stdin=handle)
            if database_fingerprint(staging_db, native) != manifest['databases'][name]:
                raise ValueError('Restored database IDs/content differ: ' + name)
        save_json(directory / 'rehearsal.json', {'state': 'passed', 'database_fingerprints_match': True, 'native_files_extracted': True})
        print('Isolated restore passed: both database contents/IDs/ACL metadata match; native files extracted. Production untouched.')
    finally:
        for prefix, flags, staging_db in databases:
            run(prefix + ['dropdb', *flags, '--if-exists', staging_db])
        shutil.rmtree(rehearsal)


def restore_files(directory, native_path, journal):
    staged = []
    # Validate and extract ALL archives before touching an existing directory.
    for name, target in {**SOURCES, 'nextcloud.tar': native_path}.items():
        stage = target.parent / (target.name + '.restore-' + str(uuid.uuid4()))
        stage.mkdir(mode=0o700)
        run(['tar', '--acls', '--xattrs', '--numeric-owner', '-xpf', str(directory / name), '-C', str(stage)])
        staged.append((target, stage))
    # Load fresh databases first. Restoring into existing databases would leave
    # tables created after the checkpoint behind, causing later migration drift.
    databases = []
    for name, db, owner, prefix, flags in [
        ('gravitas.dump', 'gravitas', 'gravitas', ['sudo', '-u', 'postgres'], []),
        ('nextcloud.dump', 'nextcloud', 'nextcloud', ['docker', 'exec', '-i', 'gravitas-nextcloud-db'], ['-U', 'nextcloud']),
    ]:
        journal['phase'] = 'restoring-' + name; save_json(BASE / 'restore.json', journal)
        stage_db = db + '_restore_' + uuid.uuid4().hex[:16]
        run(prefix + ['createdb', *flags, '-O', owner, stage_db])
        with (directory / name).open('rb') as handle:
            run(prefix + ['pg_restore', *flags, '--single-transaction', '-d', stage_db], stdin=handle)
        databases.append((db, stage_db, prefix, flags))
    for db, stage_db, prefix, flags in databases:
        prior_db = db + '_prior_' + uuid.uuid4().hex[:16]
        journal['phase'] = 'exchanging-database'
        journal['database_exchange'] = {'target': db, 'stage': stage_db, 'prior': prior_db}
        save_json(BASE / 'restore.json', journal)
        run(prefix + ['psql', *flags, '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c',
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{db}' AND pid <> pg_backend_pid();"], stdout=subprocess.DEVNULL)
        exists = output(prefix + ['psql', *flags, '-At', '-d', 'postgres', '-c', f"SELECT 1 FROM pg_database WHERE datname = '{db}';"])
        if exists == '1':
            run(prefix + ['psql', *flags, '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', f'ALTER DATABASE "{db}" RENAME TO "{prior_db}";'], stdout=subprocess.DEVNULL)
        run(prefix + ['psql', *flags, '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', f'ALTER DATABASE "{stage_db}" RENAME TO "{db}";'], stdout=subprocess.DEVNULL)
    for target, stage in staged:
        prior = target.parent / (target.name + '.pre-restore-' + str(uuid.uuid4()))
        journal['phase'] = 'restoring-directory'
        journal['exchange'] = {'target': str(target), 'stage': str(stage), 'prior': str(prior)}
        save_json(BASE / 'restore.json', journal)
        if target.exists():
            os.replace(target, prior)
        os.replace(stage, target)
        # Prior trees are retained for recovery; this command never purges them.
    run(['docker', 'exec', 'gravitas-nextcloud-redis', 'redis-cli', 'FLUSHDB'], stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('backup', 'restore', 'verify', 'rehearse', 'resume'))
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.action in {'restore', 'verify', 'rehearse'} and not args.checkpoint:
        parser.error('--checkpoint required')
    if args.action == 'verify':
        verify(args.checkpoint); print('Checkpoint integrity verified'); return
    if not args.apply:
        print('Inspection only: ' + args.action + '. Both databases, site/backend and the native Nextcloud volume move together. Apply runs on the configured server as root. Restore first captures a safety checkpoint.'); return
    if os.geteuid() != 0:
        parser.error('Apply requires server root')
    os.umask(0o077)
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if BASE.is_symlink() or BASE.stat().st_mode & 0o077:
        raise ValueError('Checkpoint directory must be root-private')
    # Prevent concurrent backup/restore processes; no credentials on argv.
    import fcntl
    with (BASE / 'operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        pending = json.loads((BASE / 'restore.json').read_text()) if (BASE / 'restore.json').exists() else None
        interrupted = pending and pending.get('phase') != 'complete'
        if args.action == 'rehearse':
            if interrupted:
                raise ValueError('Complete interrupted restore before rehearsal')
            rehearse(args.checkpoint.resolve()); return
        if args.action == 'resume':
            if (BASE / 'restore.json').exists() and json.loads((BASE / 'restore.json').read_text()).get('phase') != 'complete':
                raise ValueError('Incomplete restore: inspect restore.json and restore the safety checkpoint first')
            resume(json.loads((BASE / 'runtime.json').read_text())); return
        if args.action == 'restore':
            manifest = verify(args.checkpoint)
            if manifest.get('images') != images():
                raise ValueError('Nextcloud container versions differ: match the checkpoint images before restoring')
        if interrupted and (args.action != 'restore' or args.checkpoint.resolve() != Path(pending['safety']).resolve()):
            raise ValueError('Interrupted restore: only its verified safety checkpoint can be restored')
        native_path = volume_path()
        if interrupted:
            state = json.loads((BASE / 'runtime.json').read_text())
            for unit in active_units():
                run(['systemctl', 'stop', unit])
            run(['docker', 'stop', 'gravitas-nextcloud'], stdout=subprocess.DEVNULL)
        else:
            state = pause()
        success = False
        try:
            safety = Path(pending['safety']) if interrupted else capture(native_path, state)
            print('Checkpoint: ' + str(safety))
            if args.action == 'restore':
                journal = {'source': str(args.checkpoint.resolve()), 'safety': str(safety), 'phase': 'prepared'}
                save_json(BASE / 'restore.json', journal)
                restore_files(args.checkpoint.resolve(), native_path, journal)
                if manifest.get('databases'):
                    for database, native in [('gravitas', False), ('nextcloud', True)]:
                        if database_fingerprint(database, native) != manifest['databases'][database]:
                            raise ValueError('Restored database identity/content verification failed; writers remain paused')
                # Keep the restored app closed until both native DBs/files are
                # in place, even if this was an older non-maintenance snapshot.
                run(['docker', 'start', 'gravitas-nextcloud'], stdout=subprocess.DEVNULL)
                run(['docker', 'exec', '-u', 'www-data', 'gravitas-nextcloud', 'php', 'occ', 'maintenance:mode', '--on'], stdout=subprocess.DEVNULL)
                restored_status = json.loads(output(['docker', 'exec', '-u', 'www-data', 'gravitas-nextcloud', 'php', 'occ', 'status', '--output=json']))
                expected_version = manifest['runtime']['nextcloud_version']
                if not restored_status.get('installed') or restored_status.get('needsDbUpgrade') or restored_status.get('version') != expected_version:
                    raise ValueError('Restored Nextcloud schema/version validation failed; writers remain paused')
                journal['phase'] = 'complete'; save_json(BASE / 'restore.json', journal)
            success = True
        finally:
            if success or args.action == 'backup':
                resume(state)
            else:
                print('Restore interrupted. Writers remain paused; inspect the private restore journal and safety checkpoint.')


if __name__ == '__main__':
    main()
