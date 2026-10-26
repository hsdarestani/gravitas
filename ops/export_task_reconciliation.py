"""Run an authorized read-only DB snapshot; never deploy or mutate data."""
import argparse
import importlib.util
import json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--module', required=True)
    args = parser.parse_args()
    import django
    django.setup()
    from django.db import connection, transaction
    from django.core.serializers.json import DjangoJSONEncoder
    spec = importlib.util.spec_from_file_location('core.task_reconciliation_export', args.module)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        data = module.snapshot()
    print(json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()

# Produce a current checkpoint during the authorized migration.
# Refresh read-only reconciliation evidence for the 2026-10-22 task merge review.

# Read-only full-state verification after imported task copy repair (2026-10-26).

# Read-only final postdeployment verification for complete historical task copy repair.
