"""One-run encrypted transport for an authorized task migration plan.

Only the public key leaves production. This key encrypts data in transit; it
is not an authentication credential and grants no platform access.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path('/var/lib/gravitas-source-migrations')
RUN = 'team-docs-20261015-v1'


def keypair():
    folder = ROOT / RUN
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = folder / 'transport-key.pem'
    if path.is_symlink():
        raise ValueError('key_path_must_not_be_symlink')
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    else:
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        with path.open('xb') as output:
            os.chmod(path, 0o600)
            output.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            output.flush();os.fsync(output.fileno())
    return key


def decrypt(envelope, output):
    data = json.loads(Path(envelope).read_text())
    if data.get('schema') != 1 or data.get('run_id') != RUN:
        raise ValueError('invalid_envelope')
    key = keypair()
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    if hashlib.sha256(public).hexdigest() != data['recipient_sha256']:
        raise ValueError('wrong_recipient')
    dek = key.decrypt(base64.b64decode(data['wrapped_key']), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    raw = AESGCM(dek).decrypt(base64.b64decode(data['nonce']), base64.b64decode(data['ciphertext']), RUN.encode())
    if hashlib.sha256(raw).hexdigest() != data['plaintext_sha256']:
        raise ValueError('invalid_plaintext_digest')
    plan = json.loads(raw)
    if plan.get('run_id') != RUN:
        raise ValueError('wrong_plan_run')
    path = Path(output)
    if path.parent.resolve() != (ROOT / RUN).resolve():
        raise ValueError('private_output_directory_required')
    with path.open('xb') as out:
        os.chmod(path,0o600);out.write(raw);out.flush();os.fsync(out.fileno())
    return path


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['public-key','decrypt']);parser.add_argument('--envelope');parser.add_argument('--output');args=parser.parse_args()
    if args.action=='public-key':
        print(keypair().public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode(),end='')
    else:
        decrypt(args.envelope,args.output)
