"""Encrypt authorized migration evidence before it leaves the production host.

Only the receiving client's public key is sent to production. No credentials,
transport private keys or arbitrary server files enter the export bundle.
"""
import argparse,base64,hashlib,io,json,os,tarfile
from pathlib import Path
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')
AAD=b'team-docs-20261015-v1:audit-export:v1'


def encrypt_bytes(raw,public):
    key=serialization.load_pem_public_key(public);dek=os.urandom(32);nonce=os.urandom(12)
    b64=lambda value:base64.b64encode(value).decode()
    return {'schema':1,'run_id':'team-docs-20261015-v1','kind':'encrypted-audit-export',
        'recipient_sha256':hashlib.sha256(public).hexdigest(),'plaintext_sha256':hashlib.sha256(raw).hexdigest(),
        'wrapped_key':b64(key.encrypt(dek,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))),
        'nonce':b64(nonce),'ciphertext':b64(AESGCM(dek).encrypt(nonce,raw,AAD))}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--public-key',required=True);args=parser.parse_args()
    import django
    django.setup()
    from django.db import connection,transaction
    from django.core.serializers.json import DjangoJSONEncoder
    from core.task_reconciliation_export import snapshot
    with transaction.atomic():
        if connection.vendor=='postgresql':
            with connection.cursor() as cursor:cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        current=snapshot(workspace_id=75)
    paths=[ROOT/name for name in ['before-apply.json','timestamp-precision.json','qa-recovery-fixture.json','after-apply.json','verification.json','final-snapshot.json','portfolio-before.json','portfolio-after.json','portfolio-verification.json']]
    paths+=sorted(ROOT.glob('audit-*.json'))+sorted(ROOT.glob('control-pause-*.json'))
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w:gz') as archive:
        data=json.dumps(current,cls=DjangoJSONEncoder,ensure_ascii=False).encode();info=tarfile.TarInfo('task-reconciliation.json');info.size=len(data);info.mode=0o600;archive.addfile(info,io.BytesIO(data))
        for path in paths:
            if path.exists():
                if path.is_symlink() or path.resolve().parent!=ROOT.resolve():raise ValueError('unsafe_audit_path')
                archive.add(path,arcname=path.name,recursive=False)
    print(json.dumps(encrypt_bytes(buffer.getvalue(),Path(args.public_key).read_bytes())))


if __name__=='__main__':main()
