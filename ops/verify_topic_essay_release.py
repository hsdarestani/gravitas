"""Check the Essay migration and exercise the editor API without committing changes."""
import hashlib
import json
import sys
from urllib.parse import quote, unquote, urlsplit
from xml.etree import ElementTree

import django

django.setup()

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.test import RequestFactory
from django.urls import resolve

from core import cloud
from core.models import NextcloudIdentity, ResearchProject, TopicEssayPublication, TopicEssayVersion
from core.topic_essay_api import read_essay_markdown
from core.topic_essay_versions import record_publication

FIELDS = ('project_id', 'source_path', 'source_etag', 'markdown', 'published_at', 'published_by_id')
DAV = '{DAV:}'


def digest(rows):
    data = json.dumps(list(rows), default=str, ensure_ascii=False).encode()
    return hashlib.sha256(data).hexdigest()


def baseline():
    return digest(TopicEssayPublication.objects.order_by('pk').values_list('pk', *FIELDS))


def check_versions(previous):
    seeded = TopicEssayVersion.objects.filter(number=1).order_by('publication_id')
    if baseline() != previous or digest(seeded.values_list('publication_id', *FIELDS)) != previous:
        raise SystemExit('Essay backfill failed to preserve the live Markdown and publication metadata.')
    live = list(TopicEssayPublication.objects.filter(project_id=settings.TOPIC_01_RESEARCH_PROJECT_ID)
                .select_related('project__owner'))
    if TopicEssayPublication.objects.exists() and not live:
        raise SystemExit('Existing Essay entries are outside the configured Topic 01 project.')

    factory = RequestFactory()

    def api(method, url, owner, data):
        if method == 'POST':
            request = factory.post(url, data, content_type='application/json')
        else:
            request = factory.get(url, data)
        request.user = owner
        match = resolve(url)
        response = match.func(request, **match.kwargs)
        if response.status_code != 200:
            raise SystemExit(f'Essay {method} returned {response.status_code}.')
        return json.loads(response.content)

    for essay in live:
        url = f'/api/platform/projects/{essay.project_id}/topic-essays/{essay.depth}/versions/'
        owner = essay.project.owner
        anonymous = factory.get(url)
        anonymous.user = AnonymousUser()
        route = resolve(url)
        if route.func(anonymous, **route.kwargs).status_code != 403:
            raise SystemExit('Essay history must deny anonymous requests.')
        history = api('GET', url, owner, {})
        if history['current'] != 1 or api('GET', url, owner, {'number': 1})['markdown'] != essay.markdown:
            raise SystemExit(f'Essay {essay.depth} is missing its original version.')
        original = essay.markdown
        with transaction.atomic():
            project = ResearchProject.objects.select_for_update().get(pk=essay.project_id)
            draft = record_publication(
                essay, depth=essay.depth, project=project, path=essay.source_path,
                etag=essay.source_etag, markdown=original + '\n\nEssay version verification.\n', publisher=owner,
            )
            comparison = api('GET', url, owner, {'from': 1, 'to': draft.number})
            restored = api('POST', url, owner, {
                'number': 1, 'version': draft.published_at.isoformat(), 'confirm': True,
            })
            if (not comparison['groups'] or restored['number'] != 3
                    or api('GET', url, owner, {'number': 3})['markdown'] != original):
                raise SystemExit(f'Essay {essay.depth} failed comparison or restore.')
            transaction.set_rollback(True)
    if baseline() != previous or seeded.count() != TopicEssayVersion.objects.count():
        raise SystemExit('Essay verification unexpectedly persisted a change.')
    print(f'Essay backfill verified for {seeded.count()} live slots. Compare and restore checks rolled back.')


def nextcloud_versions(url, username, auth):
    with cloud._request('PROPFIND', url, auth=auth, expected={207, 403, 404},
                        headers={'Depth': '0', 'Content-Type': 'application/xml'},
                        data=b'<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">'
                             b'<d:prop><oc:fileid/></d:prop></d:propfind>') as response:
        if response.status_code != 207:
            return f'source unavailable ({response.status_code})'
        file_id = ElementTree.fromstring(response.content).findtext('.//{http://owncloud.org/ns}fileid')
    if not file_id or not file_id.isdecimal():
        return 'source file ID unavailable'

    listing = f'{settings.NEXTCLOUD_INTERNAL_URL}/remote.php/dav/versions/{quote(username, safe="")}/versions/{file_id}'
    with cloud._request('PROPFIND', listing, auth=auth, expected={207, 403, 404, 405, 501},
                        headers={'Depth': '1'}) as response:
        if response.status_code != 207:
            return f'versions listing unavailable ({response.status_code})'
        root = ElementTree.fromstring(response.content)
    revisions = {
        unquote(urlsplit(href.text or '').path.rstrip('/').rsplit('/', 1)[-1])
        for href in root.findall(f'{DAV}response/{DAV}href')
        if urlsplit(href.text or '').path.rstrip('/') != urlsplit(listing).path
    }
    revisions = {item for item in revisions if item.isdecimal()}
    if not revisions:
        return 'no retained revisions listed'
    latest = max(revisions, key=int)
    with cloud._request('GET', f'{listing}/{latest}', auth=auth, expected={200, 403, 404}, stream=True) as response:
        readable = response.status_code == 200 and bool(read_essay_markdown(response).strip())
    return f'{len(revisions)} retained revision(s), latest Markdown readable: {readable}'


def check_nextcloud():
    for essay in TopicEssayPublication.objects.select_related('project'):
        if essay.project_id != settings.TOPIC_01_RESEARCH_PROJECT_ID:
            continue
        path = f'{cloud.project_mountpoint(essay.project)}/{essay.source_path}'
        reader = NextcloudIdentity.objects.filter(user_id=essay.project.owner_id).first()
        try:
            if reader:
                result = nextcloud_versions(cloud._dav_url(reader, path), reader.username, cloud._auth(reader))
            else:
                result = 'authorized project owner DAV identity unavailable'
            if not reader or 'unavailable' in result:
                admin = cloud._admin_auth()
                result = nextcloud_versions(cloud._admin_dav_url(path), admin[0], admin)
        except (cloud.CloudError, ImproperlyConfigured, ValueError, ElementTree.ParseError) as exc:
            result = f'could not verify ({type(exc).__name__})'
        print(f'Nextcloud {essay.depth}: {result}')


if __name__ == '__main__':
    action = sys.argv[1]
    if action == 'baseline':
        print(baseline())
    elif action == 'verify':
        check_versions(sys.argv[2])
    elif action == 'nextcloud':
        check_nextcloud()
    else:
        raise SystemExit('Unknown essay verification action.')
