"""Private local S3 for GraviQuest; never prints credentials or signed URLs.

SeaweedFS runs as a separate, constrained system account. Only two bucket paths
are exposed over verified HTTPS; filer/master/admin endpoints stay on loopback.
Discourse's supported CDN URL and AWS SDK path-style configuration let both apps
reuse GraviQuest's existing HTTPS hostname without rewriting signed S3 paths.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = '4.52'
SHA256 = '8b538c22d47d0c3fb6792adaa6b0c735a967401270a53427d5a476dcaca9b7ae'
BASE = Path('/etc/graviquest-objectstore')
FORUM_CONFIG = Path('/etc/gravitas/forum.json')
NGINX = Path('/etc/nginx')
DATA = Path('/var/lib/graviquest-objectstore')
ENDPOINT = 'https://graviquest.com'
BUCKETS = ('graviquest-uploads', 'graviquest-backups')
SERVICE = 'graviquest-objectstore'
PORTS = (18890, 18893, 18894, 18895, 28890, 28893, 28894, 28895)


def command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def write(path, data, mode=0o600):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.new')
    tmp.write_text(data); os.chmod(tmp,mode); os.replace(tmp,path)


def state():
    return json.loads((BASE/'credentials.json').read_text())


def setup():
    assert not Path('/etc/seaweedfs/filer.toml').exists(), 'Unmanaged global filer configuration needs explicit isolation'
    BASE.mkdir(parents=True,exist_ok=True); os.chmod(BASE,0o750)
    config_path=FORUM_CONFIG
    forum=json.loads(config_path.read_text())
    path=BASE/'credentials.json'
    if path.exists():
        cfg=state()
        assert cfg['managed_by']=='graviquest-objectstore', 'Unrecognized storage installation'
        cfg.update(endpoint=ENDPOINT, version=VERSION)
        write(path,json.dumps(cfg,indent=2))
    else:
        assert not forum.get('DISCOURSE_S3_ACCESS_KEY_ID'), 'Existing S3 credentials must not be replaced'
        for port in PORTS:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1',port))
        cfg={'managed_by':'graviquest-objectstore','version':VERSION,'endpoint':ENDPOINT}
        for role in ('admin','forum'):
            cfg[role]={'access_key':'GQ'+secrets.token_hex(10).upper(),'secret_key':secrets.token_urlsafe(40)}
        write(path,json.dumps(cfg,indent=2))
    try:
        account=pwd.getpwnam(SERVICE)
    except KeyError:
        command(['useradd','--system','--home-dir',str(DATA),'--shell','/usr/sbin/nologin',SERVICE])
        account=pwd.getpwnam(SERVICE)
    DATA.mkdir(parents=True,exist_ok=True); os.chmod(DATA,0o750)
    os.chown(DATA,account.pw_uid,account.pw_gid)
    identities=[{'name':'graviquest-storage-admin','credentials':[{'accessKey':cfg['admin']['access_key'],'secretKey':cfg['admin']['secret_key']}],'actions':['Admin']},
                {'name':'graviquest-discourse','credentials':[{'accessKey':cfg['forum']['access_key'],'secretKey':cfg['forum']['secret_key']}],
                 'actions':['Admin:'+bucket for bucket in BUCKETS]}]
    write(BASE/'s3.json',json.dumps({'identities':identities},indent=2),0o640)
    os.chown(BASE,0,account.pw_gid); os.chown(BASE/'s3.json',0,account.pw_gid)
    unit='''[Unit]
Description=GraviQuest private S3 object storage (SeaweedFS)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=graviquest-objectstore
Group=graviquest-objectstore
WorkingDirectory=/var/lib/graviquest-objectstore
ExecStart=/opt/graviquest-objectstore/weed mini -dir=/var/lib/graviquest-objectstore -ip=127.0.0.1 -ip.bind=127.0.0.1 -s3.port=18890 -master.port=18893 -volume.port=18894 -filer.port=18895 -s3.config=/etc/graviquest-objectstore/s3.json -s3.autoCreateBucket=false -s3.iam=false -admin.ui=false -webdav=false -s3.port.iceberg=0 -s3.port.lance=0 -master.telemetry=false -master.volumeSizeLimitMB=256 -volume.max=64 -volume.index=leveldb -volume.fileSizeLimitMB=64 -volume.concurrentUploadLimitMB=64 -s3.readerCacheSizeMB=32 -s3.cacheCapacityMB=16 -s3.defaultFileMode=0660
Environment=GOMEMLIMIT=384MiB
Environment=GOGC=75
Restart=on-failure
RestartSec=3
TimeoutStopSec=45
MemoryMax=512M
MemorySwapMax=0
CPUQuota=50%
TasksMax=128
Nice=10
IOWeight=50
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/graviquest-objectstore
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
[Install]
WantedBy=multi-user.target
'''
    unit_path=Path('/etc/systemd/system/'+SERVICE+'.service')
    changed=not unit_path.exists() or unit_path.read_text()!=unit
    write(unit_path,unit,0o644)
    command(['systemctl','daemon-reload'])
    command(['systemctl','enable',SERVICE])
    if changed or subprocess.run(['systemctl','is-active','--quiet',SERVICE]).returncode:
        command(['systemctl','restart',SERVICE])
    else:
        command(['systemctl','start',SERVICE])
    print('Isolated S3 service configured: 512 MiB RAM cap, 0.5 CPU, bounded volume slots, loopback listeners only.')


def snippets():
    sections=[]
    for bucket in BUCKETS:
        for path in ('= /'+bucket, '^~ /'+bucket+'/'):
            sections.append('''    location %s {
        proxy_pass http://127.0.0.1:18890;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Cookie "";
        # User files share the apex hostname. Force an opaque sandbox for
        # document navigations so uploaded active content cannot use site auth.
        add_header Content-Security-Policy "sandbox; default-src 'none'; style-src 'unsafe-inline'" always;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy no-referrer always;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 120s;
        client_max_body_size 64m;
    }
''' % path)
    write(NGINX/'snippets/graviquest-storage.conf','# Managed GraviQuest S3 bucket routes; preserve canonical signed paths.\n'+''.join(sections),0o644)


def nginx(ssl):
    """Atomically reload only the dedicated Forum virtual host, with rollback."""
    path=NGINX/'sites-available/graviquest-forum'
    link=NGINX/'sites-enabled/graviquest-forum'
    snippet=NGINX/'snippets/graviquest-storage.conf'
    old_snippet=snippet.read_text() if snippet.exists() else None
    old=path.read_text() if path.exists() else None
    assert old is None or old.startswith('# Managed GraviQuest Discourse'), 'Unmanaged Forum nginx configuration must not be overwritten'
    if ssl and old and 'proxy_pass http://127.0.0.1:18880' in old:
        # An already activated native forum keeps all of its existing routing.
        if 'include /etc/nginx/snippets/graviquest-storage.conf;' in old:
            return
        text=old.replace('    location / {\n        proxy_pass http://127.0.0.1:18880;',
                         '    include /etc/nginx/snippets/graviquest-storage.conf;\n    location / {\n        proxy_pass http://127.0.0.1:18880;')
        assert text!=old, 'Cannot safely locate existing managed Forum routing'
    else:
        text='''# Managed GraviQuest Discourse
server {
    listen 80;
    server_name forum.graviquest.com;
    location /.well-known/acme-challenge/ { root /var/www/gravitas-forum-acme; }
    location / { %s }
}
''' % ('return 301 https://forum.graviquest.com$request_uri;' if ssl else 'return 503;')
        if ssl:
            text+='''server {
    listen 443 ssl;
    server_name forum.graviquest.com;
    ssl_certificate /etc/letsencrypt/live/forum.graviquest.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forum.graviquest.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    include /etc/nginx/snippets/graviquest-storage.conf;
    location / { return 503; }
}
'''
    linked=link.is_symlink()
    assert linked or not link.exists(), 'Unexpected non-symlink nginx entry'
    if ssl: snippets()
    write(path,text,0o644)
    if not linked: link.symlink_to(path)
    try:
        command(['nginx','-t']); command(['systemctl','reload','nginx'])
    except subprocess.CalledProcessError:
        if old is None: path.unlink(missing_ok=True)
        else: write(path,old,0o644)
        if not linked: link.unlink(missing_ok=True)
        if old_snippet is None: snippet.unlink(missing_ok=True)
        else: write(snippet,old_snippet,0o644)
        command(['nginx','-t'])
        raise RuntimeError('New storage virtual host rejected; previous nginx configuration restored') from None


def nginx_main():
    """Add only two isolated bucket routes to the existing, verified TLS host.

    Forum DNS currently points elsewhere. Reuse the working apex certificate
    without changing any existing API, Workspace, Lab or static route.
    """
    path=NGINX/'sites-available/gravitas'
    snippet=NGINX/'snippets/graviquest-storage.conf'
    old=path.read_text()
    old_snippet=snippet.read_text() if snippet.exists() else None
    assert old_snippet is None or not old_snippet.strip() or old_snippet.startswith('# Managed GraviQuest S3'), 'Unmanaged storage routing must not be overwritten'
    anchor=r'(?m)^([ \t]*)ssl_certificate /etc/letsencrypt/live/graviquest.com/fullchain.pem;$'
    assert len(re.findall(anchor,old))==1, 'Expected the existing GraviQuest TLS certificate exactly once'
    include='include /etc/nginx/snippets/graviquest-storage*.conf;'
    assert not any(re.search(r'location\s+(?:=\s+|\^~\s+)?/'+bucket+r'(?:/|\s|\{)',old) for bucket in BUCKETS), 'Existing bucket paths must not be replaced'
    if include not in old:
        updated=re.sub(anchor,lambda match:match.group(1)+include+'\n'+match.group(0),old)
    else:
        updated=old
    snippets()
    write(path,updated,0o644)
    try:
        command(['nginx','-t']); command(['systemctl','reload','nginx'])
    except subprocess.CalledProcessError:
        write(path,old,0o644)
        if old_snippet is None: snippet.unlink(missing_ok=True)
        else: write(snippet,old_snippet,0o644)
        command(['nginx','-t']); command(['systemctl','reload','nginx'])
        raise RuntimeError('Storage routes rejected; previous GraviQuest nginx configuration restored') from None
    print('Added only the two S3 bucket paths to existing GraviQuest HTTPS; all existing routes preserved.')


def sdk(endpoint, role='forum', unsigned=False):
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config
    cfg=state()[role]
    return boto3.client('s3',endpoint_url=endpoint,region_name='us-east-1',
        aws_access_key_id=cfg['access_key'],aws_secret_access_key=cfg['secret_key'],
        config=Config(signature_version=UNSIGNED if unsigned else 's3v4',s3={'addressing_style':'path'},
                      connect_timeout=5,read_timeout=20,retries={'max_attempts':2}))


def provision():
    client=sdk('http://127.0.0.1:18890','admin')
    for attempt in range(45):
        try:
            client.list_buckets(); break
        except Exception:
            if attempt==44: raise RuntimeError('Local S3 did not become ready') from None
            time.sleep(1)
    from botocore.exceptions import ClientError
    for bucket in BUCKETS:
        try: client.head_bucket(Bucket=bucket)
        except ClientError as exc:
            if exc.response['ResponseMetadata']['HTTPStatusCode']!=404: raise
            client.create_bucket(Bucket=bucket,ACL='private')
        # Discourse changes ACLs on its own uploads. Explicit ObjectWriter
        # ownership keeps each new object's owner equal to the scoped app
        # identity, rather than silently assigning it to the provisioner.
        client.put_bucket_ownership_controls(Bucket=bucket,OwnershipControls={
            'Rules':[{'ObjectOwnership':'ObjectWriter'}]})
        client.put_bucket_cors(Bucket=bucket,CORSConfiguration={'CORSRules':[{
            'AllowedOrigins':['https://forum.graviquest.com','https://graviquest.com'],
            'AllowedMethods':['GET','HEAD','PUT','POST','DELETE'],'AllowedHeaders':['*'],
            'ExposeHeaders':['ETag'],'MaxAgeSeconds':3600}]})
    print('Two private buckets and scoped application identity provisioned; no public bucket policy.')


def verify():
    from botocore.exceptions import ClientError
    client=sdk(ENDPOINT); anonymous=sdk(ENDPOINT,unsigned=True)
    token=secrets.token_hex(12); prefix='__graviquest_storage_acceptance/'+token+'/'
    body=secrets.token_bytes(4096)
    def denied(fn, label):
        try: fn()
        except ClientError as exc:
            assert exc.response['ResponseMetadata']['HTTPStatusCode'] in (401,403), label
        else: raise AssertionError(label)
    try:
        for bucket in BUCKETS:
            print('Verifying signed writes, private denial and signed downloads in '+bucket+'.',flush=True)
            client.put_object(Bucket=bucket,Key=prefix+'private',Body=body,ACL='private')
            denied(lambda:anonymous.get_object(Bucket=bucket,Key=prefix+'private'),'Private object must deny anonymous reads')
            denied(lambda:anonymous.list_objects_v2(Bucket=bucket),'Bucket listing must deny anonymous reads')
            denied(lambda:anonymous.put_object(Bucket=bucket,Key=prefix+'unauthorized',Body=b'no'),'Unsigned writes must be denied')
            signed=client.generate_presigned_url('get_object',Params={'Bucket':bucket,'Key':prefix+'private'},ExpiresIn=60)
            with urllib.request.urlopen(signed,timeout=15) as response:
                assert hashlib.sha256(response.read()).digest()==hashlib.sha256(body).digest()
        print('Verifying public-to-private object ACL changes.',flush=True)
        client.put_object(Bucket=BUCKETS[0],Key=prefix+'public',Body=body,ACL='public-read')
        public_response=anonymous.get_object(Bucket=BUCKETS[0],Key=prefix+'public')
        assert public_response['Body'].read()==body
        public_headers=public_response['ResponseMetadata']['HTTPHeaders']
        assert public_headers.get('content-security-policy', '').startswith('sandbox;'), 'Uploaded documents must have an opaque sandbox'
        assert public_headers.get('x-content-type-options')=='nosniff', 'Uploaded content must not bypass MIME checks'
        client.put_object_acl(Bucket=BUCKETS[0],Key=prefix+'public',ACL='private')
        denied(lambda:anonymous.get_object(Bucket=BUCKETS[0],Key=prefix+'public'),'Changing public object to private must remove anonymous access')
        # Exercise IAM on loopback: the public nginx endpoint exposes only our
        # two bucket paths and would reject an unrelated PUT before S3 sees it.
        scoped_local=sdk('http://127.0.0.1:18890')
        denied(lambda:scoped_local.create_bucket(Bucket='graviquest-unrelated-'+token),'Application key must not create unrelated buckets')
        command(['systemctl','restart',SERVICE]); time.sleep(3)
        for bucket in BUCKETS:
            assert client.get_object(Bucket=bucket,Key=prefix+'private')['Body'].read()==body
            denied(lambda:anonymous.get_object(Bucket=bucket,Key=prefix+'private'),'Private ACL must survive storage restart')
        write(BASE/'acceptance.json',json.dumps({'https_verified':True,'private_denial_verified':True,
              'signed_download_verified':True,'public_to_private_acl_verified':True,'scoped_credentials_verified':True,
              'restart_bytes_and_acl_verified':True,'version':VERSION},indent=2))
        print('S3 HTTPS, private denial, signed downloads, public-to-private ACLs, scoped keys and storage restart persistence verified.')
    finally:
        for bucket in BUCKETS:
            client.delete_objects(Bucket=bucket,Delete={'Objects':[{'Key':prefix+name} for name in ('private','public','unauthorized')]})


def connect():
    assert json.loads((BASE/'acceptance.json').read_text())['private_denial_verified']
    cfg=state(); path=FORUM_CONFIG; forum=json.loads(path.read_text())
    forum.update({'GRAVITAS_LOCAL_S3':'seaweedfs-'+VERSION,
                  'DISCOURSE_S3_ACCESS_KEY_ID':cfg['forum']['access_key'],
                  'DISCOURSE_S3_SECRET_ACCESS_KEY':cfg['forum']['secret_key'],
                  'DISCOURSE_S3_REGION':'us-east-1','DISCOURSE_S3_UPLOAD_BUCKET':BUCKETS[0],
                  'DISCOURSE_S3_ENDPOINT':ENDPOINT,'DISCOURSE_S3_CDN_URL':ENDPOINT+'/'+BUCKETS[0],
                  'DISCOURSE_S3_USE_CDN_URL_FOR_ALL_UPLOADS':'true'})
    write(path,json.dumps(forum,indent=2))
    print('Discourse configured for the verified local S3 service; existing SMTP and SSO secrets preserved.')


def health():
    command(['systemctl','is-active','--quiet',SERVICE])
    assert shutil.disk_usage(DATA).free > 5*1024**3, 'S3 host has less than 5 GiB free disk'
    client=sdk(ENDPOINT)
    for bucket in BUCKETS:
        client.head_bucket(Bucket=bucket)
    print('S3 process, free disk and authenticated HTTPS bucket access are healthy.')


def monitor():
    health()
    write('/etc/systemd/system/graviquest-objectstore-health.service','''[Unit]
Description=Check private GraviQuest S3 availability and free disk
After=network-online.target graviquest-objectstore.service
[Service]
Type=oneshot
ExecStart=/opt/graviquest-objectstore/venv/bin/python /opt/graviquest-objectstore/storage.py health
TimeoutStartSec=90
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
''',0o644)
    write('/etc/systemd/system/graviquest-objectstore-health.timer','''[Unit]
Description=Monitor GraviQuest S3 every five minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
''',0o644)
    command(['systemctl','daemon-reload'])
    command(['systemctl','enable','--now','graviquest-objectstore-health.timer'])
    command(['systemctl','start','graviquest-objectstore-health.service'])
    print('S3 health timer enabled; failures are recorded in the systemd journal.')


if __name__=='__main__':
    assert os.geteuid()==0, 'Run as root through the authorized deployment workflow'
    mode=sys.argv[1]
    try:
        {'setup':setup,'http':lambda:nginx(False),'https':lambda:nginx(True),'main-https':nginx_main,
         'provision':provision,'verify':verify,'connect':connect,'health':health,'monitor':monitor}[mode]()
    except Exception as exc:
        if isinstance(exc,(AssertionError,RuntimeError)):
            print(str(exc),file=sys.stderr)
        elif hasattr(exc,'response'):
            print('S3 '+mode+' failed in '+getattr(exc,'operation_name','unknown operation')+': '+str(exc.response.get('Error',{}).get('Code','unknown')),file=sys.stderr)
        else:
            print('Storage '+mode+' failed: '+type(exc).__name__,file=sys.stderr)
        raise SystemExit(1)
