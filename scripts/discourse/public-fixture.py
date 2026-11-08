"""Recorded, temporary identities for real public GraviQuest-to-Forum acceptance.

Run as the existing Django service account. No existing account is reused,
promoted or selected by a broad query. Passwords remain in private runtime files.
"""
import json
import os
from pathlib import Path
import re
import secrets
import sys

import django
django.setup()
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from core.email_verification import mark_email_verified
from core.layer_models import CommunityProfile

STATE=Path('/var/lib/graviquest-forum/acceptance/users.json')


def write(data):
    temporary=STATE.with_suffix('.new')
    temporary.write_text(json.dumps(data,indent=2));os.chmod(temporary,0o600)
    os.replace(temporary,STATE)


def main(mode):
    User=get_user_model()
    if mode=='prepare':
        assert not STATE.exists(), 'Recorded public acceptance requires cleanup first'
        token=secrets.token_hex(8)
        state={'managed_by':'graviquest-public-acceptance-v1','token':token,'users':{}}
        with transaction.atomic():
            for role in ('member','moderator','researcher'):
                email=f'gq-launch-{token}-{role}@example.com'
                assert not User.objects.filter(email=email).exists(), 'Acceptance email already exists'
                password=secrets.token_urlsafe(32)+'Aa7!'
                user=User.objects.create_user(username=email,email=email,password=password,
                    first_name='Launch acceptance '+role,is_active=True,is_staff=False,is_superuser=False)
                CommunityProfile.objects.update_or_create(user=user,defaults={'email_verification_required':True})
                mark_email_verified(user)
                if role!='member':
                    group_name='graviquest-forum-'+('moderators' if role=='moderator' else 'researchers')
                    group,_=Group.objects.get_or_create(name=group_name);user.groups.add(group)
                if role=='moderator':
                    # Reviewing private research needs explicit research ACLs
                    # as well as moderation authority. Only this QA identity
                    # receives that composition; no real group's ACL changes.
                    group,_=Group.objects.get_or_create(name='graviquest-forum-researchers');user.groups.add(group)
                state['users'][role]={'id':user.pk,'email':email,'password':password}
            # Save the exact IDs before committing database creation. A failed
            # write rolls back; an interrupted commit leaves only recorded IDs.
            write(state)
        print('Three recorded verified acceptance identities prepared; no existing users changed.')
    elif mode=='cleanup':
        if not STATE.exists():return
        state=json.loads(STATE.read_text())
        assert state['managed_by']=='graviquest-public-acceptance-v1'
        assert re.fullmatch('[0-9a-f]{16}',state['token'])
        with transaction.atomic():
            for role,data in state['users'].items():
                expected=f"gq-launch-{state['token']}-{role}@example.com"
                assert data['email']==expected
                user=User.objects.filter(pk=data['id']).first()
                if user:
                    assert user.email==expected and user.username==expected and not user.is_superuser
                    user.delete()
                assert not User.objects.filter(pk=data['id']).exists()
        STATE.unlink()
        print('Removed only the recorded Django acceptance identities.')
    else:raise ValueError('Unknown acceptance mode')


if __name__=='__main__':main(sys.argv[1])
