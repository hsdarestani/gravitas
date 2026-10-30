"""Read-only task chronology evidence, encrypted before leaving production.

The repository is public. Only the ephemeral public key is committed; task
titles, meeting context and the plan encryption key never enter public logs.
"""
import base64
import hashlib
import hmac
import json
import os
import zlib

PUBLIC_KEY = b'''-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArgWISWL4QFzTaWnnW+q5
8n9qx9HfIKoxhnISFOlI+PesLVIfn/9kcDH962HMkZRFT1rmpFvV5a4WnZ4qZaG9
aHwPijRrFaGjCMM+BOr5BBK1EfK+NiKuisFEGQ+TggoWp2Ojtf5dgIPqERFOC4Ol
YbnmTyYIdIi/rL3t5eG5ssNnpJpQrnY+tkiswVQ6K7A8k6U2oGmo0a4DKmIYe//7
F4/rAhDn8k4/vyzIlMiIr5MdKhR4n50dgT5DllsnlcDUE5rIozDL/IF1Onud8Oly
A8UJxQ0lm63U0obApBjhI2QN2f2wg8nWak43nSIKGOExhwnIbKedMLeHwxjE3mwl
pm9exeGYkDhxlv/dw9GnHTf1802VvbQj7NPLA8z/6zXQvHvOOBimLvIKj7r6CI2v
8zwrJ2IEdyBD/aezzqwDGpGfnPTexMJ0MgEN71/Hb5cFqNzcKM7qMaYCvRT7Qqkg
fcTQ4pXCSHcKl5CE15cu7XVSqfXJg02fi6HlGS8WFlsRAgMBAAE=
-----END PUBLIC KEY-----'''
LABEL = b'graviquest/task-meeting-date-plan/v1'


def main():
    import django
    django.setup()
    from django.conf import settings
    from django.core.serializers.json import DjangoJSONEncoder
    from django.db import connection, transaction
    from django.utils import timezone
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from core.models import Workspace
    from core.operating_models import OperatingTask
    from core.layer_models import ActivityEvent
    from core.platform_models import ProjectAuditEvent
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        cores = list(Workspace.objects.filter(platform_profile__purpose='core').values('id', 'organization_id', 'name')[:2])
        if len(cores) != 1 or not cores[0]['organization_id']:
            raise ValueError('Exactly one organization Core workspace required')
        rows = list(OperatingTask.objects.filter(workspace_id=cores[0]['id']).order_by('pk').values(
            'id', 'title', 'description', 'definition_of_done', 'status', 'priority',
            'created_at', 'started_at', 'completed_at', 'due_date', 'date_provenance',
            'updated_at', 'source_key', 'source_metadata', 'parent_id', 'project_id',
            'project__title', 'owner_id', 'owner__first_name', 'owner__last_name'))
        ids = [str(row['id']) for row in rows]
        events = list(ActivityEvent.objects.filter(object_type__in=['operating_task', 'OperatingTask', 'task'],
            object_id__in=ids).order_by('created_at', 'pk').values('id', 'object_id', 'action', 'created_at', 'detail'))
        audits = list(ProjectAuditEvent.objects.filter(object_type__in=['operating_task', 'OperatingTask', 'task'],
            object_id__in=ids).order_by('created_at', 'pk').values('id', 'object_id', 'action', 'created_at', 'detail'))
        payload = {'schema': 1, 'read_only': True, 'generated_at': timezone.now(),
            'workspace': cores[0], 'tasks': rows, 'activity': events, 'audit': audits,
            'plan_key': base64.b64encode(hmac.new(settings.SECRET_KEY.encode(), LABEL, hashlib.sha256).digest()).decode()}
    compressed = zlib.compress(json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False).encode(), 9)
    session_key, nonce = os.urandom(32), os.urandom(12)
    cipher = AESGCM(session_key).encrypt(nonce, compressed, LABEL)
    public = serialization.load_pem_public_key(PUBLIC_KEY)
    wrapped = public.encrypt(session_key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=LABEL))
    envelope = {key: base64.b64encode(value).decode() for key, value in
                {'wrapped_key': wrapped, 'nonce': nonce, 'ciphertext': cipher}.items()}
    print('TASK_DATE_ENCRYPTED_BEGIN')
    print(json.dumps(envelope, separators=(',', ':')))
    print('TASK_DATE_ENCRYPTED_END')
    print('Read-only evidence encrypted:', len(rows), 'tasks;', len(events), 'activity rows;', len(audits), 'audit rows')


if __name__ == '__main__':
    main()
