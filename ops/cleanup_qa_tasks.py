"""Remove only the two user-confirmed disposable QA task records."""
import json,os
from pathlib import Path


def main():
    import django
    django.setup()
    from django.core import serializers
    from django.db import transaction
    from django.test import RequestFactory
    from django.contrib.auth import get_user_model
    from core.operating_models import OperatingTask
    from core.task_board_api import task_board_detail
    ids=[728,729]
    rows=list(OperatingTask.objects.filter(pk__in=ids).order_by('id'))
    objects=[]
    for task in rows:
        if task.workspace_id!=75 or task.owner_id!=18 or not task.title.startswith('QA 2026-10-15 ') or task.source_key:
            raise ValueError('qa_identity_changed')
        if task.board_attachments.exists() or task.subtasks.exists() or OperatingTask.objects.filter(dependency=task).exists():
            raise ValueError('qa_relationship_requires_review')
        objects.extend([task,*task.checklist_items.all(),*task.board_comments.all()])
    root=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')
    backup=root/'qa-recovery-fixture.json'
    if rows and not backup.exists():
        with backup.open('x') as output:
            os.chmod(backup,0o600);output.write(serializers.serialize('json',objects));output.flush();os.fsync(output.fileno())
    factory=RequestFactory();actor=get_user_model().objects.get(pk=18)
    with transaction.atomic():
        for task in OperatingTask.objects.select_for_update().filter(pk__in=ids):
            request=factory.delete('/api/core/tasks/'+str(task.pk)+'/?workspace_id=75');request.user=actor
            response=task_board_detail(request,task.pk)
            if response.status_code!=200:
                raise ValueError('qa_delete_api_failed')
    if OperatingTask.objects.filter(pk__in=ids).exists():
        raise ValueError('qa_delete_readback_failed')
    print(json.dumps({'deleted_qa_ids':ids,'recovery_fixture_saved':backup.exists(),'remaining_test_tasks':0}))


if __name__=='__main__':
    main()
