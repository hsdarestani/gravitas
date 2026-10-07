"""Read-only native DB diagnostics; only counts and SQLSTATE enter logs."""
import json
import re
import subprocess

queries = {
    'activity_count': 'SELECT count(*) FROM public.oc_activity;',
    'activity_fingerprint': "SET TIME ZONE 'UTC'; SELECT json_build_object('rows', count(*), 'hash', md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), ''))) FROM public.oc_activity t;",
}
for name, query in queries.items():
    result = subprocess.run(['docker', 'exec', 'gravitas-nextcloud-db', 'psql', '-U', 'nextcloud', '-v', 'VERBOSITY=sqlstate', '-qAt', '-d', 'nextcloud', '-c', query], capture_output=True, text=True)
    states = re.findall(r'ERROR:\s*([A-Z0-9]{5})\b', result.stderr)
    print(json.dumps({'probe': name, 'success': result.returncode == 0, 'sqlstates': states,
        'rows': int(result.stdout.strip()) if name == 'activity_count' and result.returncode == 0 else None}))
