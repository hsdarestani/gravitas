"""DiscourseConnect and bounded, anonymous public reads.

The public website never forwards a visitor-supplied path, API key or username
to Discourse. Only anonymous Discourse responses can enter this feed. All
participation runs in native Discourse so its CSRF, ACL, moderation and rate
limits remain authoritative. Research summaries must not consume this feed as
an authorization substitute for private discussions.
"""
import base64
import binascii
import hashlib
import hmac
import re
from urllib.parse import parse_qs, urlencode, urlsplit

import requests
from django.conf import settings
from django.contrib.auth import get_user_model, logout
from django.contrib.auth.signals import user_logged_out
from django.dispatch import receiver
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from django.db.models.signals import m2m_changed, post_save, pre_save, pre_delete
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.utils.html import strip_tags
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from .email_verification import is_email_verified
from .forum_models import ForumDiscussion, ForumLogout
from .layer_models import CommunityProfile
from .models import ContentItem


class ForumUnavailable(Exception):
    pass


def forum_url():
    value = settings.GRAVITAS_FORUM_URL
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
            parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ForumUnavailable()
    return value.rstrip('/')


def external_id(user):
    return f'graviquest:{user.pk}'


def _response(data, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'no-store'
    return response


def _unavailable():
    return _response({'ok': False, 'error': 'forum_unavailable',
                      'message': 'The Forum is temporarily unavailable. Please try again.'}, 503)


def _get(path, params=None):
    # Deliberately no admin credentials, including for authenticated visitors.
    try:
        response = requests.get(forum_url() + path, params=params, timeout=(3, 8),
                                allow_redirects=False, headers={'Accept': 'application/json'})
        if response.status_code != 200 or len(response.content) > 2_000_000:
            raise ForumUnavailable()
        data = response.json()
        if not isinstance(data, dict):
            raise ForumUnavailable()
        return data
    except (requests.RequestException, ValueError) as exc:
        raise ForumUnavailable() from exc


def _public_categories():
    key = 'graviquest:forum:categories:v2:' + forum_url()
    categories = cache.get(key)
    if categories is None:
        data = _get('/categories.json', {'include_subcategories': 'true'})
        categories, seen = [], set()
        pending = [(c, None) for c in reversed(data.get('category_list', {}).get('categories', []))]
        # The maintained API embeds children in subcategory_list. Accept both
        # nested and flat responses, inheriting the private parent boundary.
        while pending:
            category, parent = pending.pop()
            if category.get('read_restricted') or category['id'] in seen:
                continue
            seen.add(category['id'])
            if len(seen) > 1000:
                raise ForumUnavailable()
            category = {**category}
            if parent is not None:
                category.setdefault('parent_category_id', parent)
            categories.append(category)
            pending.extend((c, category['id']) for c in reversed(category.get('subcategory_list', [])))
        cache.set(key, categories, 30)
    return [c for c in categories if not c.get('read_restricted')]


def _count(value, offset=0):
    return max(0, value + offset) if isinstance(value, int) and not isinstance(value, bool) else None


def _topic_summary(topic, categories, users=None):
    category = categories.get(topic.get('category_id'))
    if not category or topic.get('visible') is False:
        return None
    topic_id = int(topic['id'])
    # Numeric canonical route avoids trusting an upstream URL or HTML slug.
    return {'id': topic_id, 'title': str(topic.get('title', '')),
            'url': f'{forum_url()}/t/{topic_id}',
            'excerpt': strip_tags(str(topic.get('excerpt', '')))[:500],
            'category_id': category['id'], 'category': category['name'],
            'reply_count': _count(topic.get('posts_count'), -1),
            'like_count': _count(topic.get('like_count')),
            'view_count': _count(topic.get('views')),
            'participants': [{'username': str(user.get('username', '')),
                              'name': str(user.get('name') or user.get('username', '')),
                              'avatar_url': _avatar_url(user.get('avatar_template', ''))}
                             for poster in topic.get('posters', [])[:5]
                             if (user := (users or {}).get(poster.get('user_id')))],
            'last_posted_at': topic.get('last_posted_at'),
            'tags': [str(t.get('name', '') if isinstance(t, dict) else t)
                     for t in topic.get('tags', [])][:12],
            'pinned': bool(topic.get('pinned'))}


def _avatar_url(template):
    # Native local avatar routes only. External image URLs are not an open
    # tracking/redirect surface on the public GraviQuest list.
    path = str(template).replace('{size}', '48')
    parsed = urlsplit(path)
    if not path.startswith(('/user_avatar/', '/letter_avatar_proxy/', '/uploads/')) or '\\' in path or parsed.netloc or parsed.query or parsed.fragment:
        return None
    return forum_url() + path


@require_GET
@never_cache
def forum_config(request):
    try:
        base = forum_url()
    except ForumUnavailable:
        return _unavailable()
    return _response({'ok': True, 'url': base, 'login_url': base + '/session/sso',
                      'search_url': base + '/search', 'new_topic_url': base + '/new-topic'})


@require_GET
@never_cache
def forum_start(request):
    try:
        return HttpResponseRedirect(forum_url() + '/new-topic')
    except ForumUnavailable:
        return _unavailable()


@require_GET
@never_cache
def forum_open(request, content_key):
    link = _public_link(content_key)
    if not link:
        return _response({'ok': False, 'error': 'discussion_not_found'}, 404)
    try:
        return HttpResponseRedirect(forum_url() + f'/t/{link.discourse_topic_id}')
    except ForumUnavailable:
        return _unavailable()


@require_GET
@never_cache
def forum_feed(request):
    sort = request.GET.get('sort', 'latest')
    if sort not in ('latest', 'top', 'unanswered'):
        return _response({'ok': False, 'error': 'invalid_sort'}, 400)
    try:
        page = int(request.GET.get('page', '0'))
        category_id = int(request.GET.get('category', '0'))
        if not 0 <= page <= 100 or category_id < 0:
            raise ValueError()
    except (ValueError, TypeError):
        return _response({'ok': False, 'error': 'invalid_filter'}, 400)
    try:
        categories = {c['id']: c for c in _public_categories()}
        if category_id and category_id not in categories:
            return _response({'ok': False, 'error': 'category_not_found'}, 404)
        # Search belongs to the native forum. Its permissions and relevance
        # are the same on the public landing and inside a signed-in forum.
        params = {'page': page, 'include_subcategories': 'true'}
        if category_id:
            params['category'] = category_id
        if sort == 'unanswered':
            params['max_posts'] = 1
        data = _get('/top.json' if sort == 'top' else '/latest.json', params)
        topics = data.get('topic_list', {}).get('topics', [])
        users = {u['id']: u for u in data.get('users', [])}
        summaries = [s for t in topics if (s := _topic_summary(t, categories, users))]
        return _response({'ok': True, 'url': forum_url(), 'topics': summaries,
            'categories': [{'id': c['id'], 'name': c['name'], 'slug': c['slug'],
                            'parent_category_id': c.get('parent_category_id'),
                            'topic_count': c.get('topic_count', 0)} for c in categories.values()],
            'page': page, 'has_more': bool(data.get('topic_list', {}).get('more_topics_url'))})
    except (ForumUnavailable, KeyError, TypeError, ValueError):
        return _unavailable()


def _public_link(key):
    link = ForumDiscussion.objects.filter(content_key=key, is_public=True).select_related('content').first()
    if not link:
        return None
    if link.content_id and link.content.status != ContentItem.Status.PUBLISHED:
        return None
    return link


@require_GET
@never_cache
def forum_discussion(request, content_key):
    link = _public_link(content_key)
    if not link:
        return _response({'ok': False, 'error': 'discussion_not_found'}, 404)
    try:
        # Anonymous GET is an additional live ACL check. A mapping cannot
        # publish a topic moved into a private category after it was linked.
        data = _get(f'/t/{link.discourse_topic_id}.json')
        categories = {c['id']: c for c in _public_categories()}
        summary = _topic_summary(data, categories)
        if not summary:
            return _response({'ok': False, 'error': 'discussion_not_found'}, 404)
        posts = data.get('post_stream', {}).get('posts', [])
        public_posts = [{'id': p['id'], 'number': p['post_number'],
                        'username': p.get('username', ''),
                        'text': strip_tags(str(p.get('cooked', '')))[:2000],
                        'created_at': p.get('created_at'),
                        'reply_to_post_number': p.get('reply_to_post_number')}
                       for p in posts[:10] if not p.get('hidden') and not p.get('deleted_at')]
        return _response({'ok': True, 'discussion': summary, 'posts': public_posts,
                          'content_version': link.content_version,
                          'polls': posts[0].get('polls', []) if posts else []})
    except (ForumUnavailable, KeyError, TypeError, ValueError):
        return _unavailable()


@require_GET
@never_cache
def forum_sso(request):
    try:
        base = forum_url()
    except ForumUnavailable:
        return _unavailable()
    secret = settings.GRAVITAS_DISCOURSE_CONNECT_SECRET
    if len(secret) < 32:
        return _unavailable()
    encoded, signature = request.GET.get('sso', ''), request.GET.get('sig', '')
    if len(encoded) > 8192 or not re.fullmatch(r'[a-fA-F0-9]{64}', signature):
        return _response({'ok': False, 'error': 'invalid_sso'}, 400)
    expected = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature.lower()):
        return _response({'ok': False, 'error': 'invalid_sso'}, 400)
    try:
        payload = parse_qs(base64.b64decode(encoded, validate=True).decode('utf-8'),
                           strict_parsing=True, max_num_fields=12)
        nonce, return_url = payload['nonce'], payload['return_sso_url']
        if len(nonce) != 1 or len(return_url) != 1 or not 1 <= len(nonce[0]) <= 200:
            raise ValueError()
        if return_url[0] != base + '/session/sso_login':
            raise ValueError()
    except (KeyError, ValueError, UnicodeDecodeError, binascii.Error):
        return _response({'ok': False, 'error': 'invalid_sso'}, 400)
    if not request.user.is_authenticated:
        # No SSO payload or user data in the login URL. The account frontend
        # resumes this same-origin endpoint only after Django confirms login.
        request.session['forum_pending_sso'] = {'sso': encoded, 'sig': signature}
        response = HttpResponseRedirect('/login?continue=forum')
        response.set_cookie('gq_forum_continue', '1', max_age=1800, secure=True, samesite='Lax')
        return response
    profile = getattr(request.user, 'gravitas_community_profile', None)
    if (not request.user.is_active or
            (profile and getattr(profile, 'status', 'active') != 'active')):
        return _response({'ok': False, 'error': 'account_unavailable'}, 403)
    if not is_email_verified(request.user):
        return _response({'ok': False, 'error': 'email_not_verified',
                          'message': 'Confirm your GraviQuest email before opening the Forum.'}, 403)
    groups = set(request.user.groups.values_list('name', flat=True))
    roles = {'researchers': 'graviquest-forum-researchers',
             'reviewers': 'graviquest-forum-reviewers'}
    fields = {'nonce': nonce[0], 'external_id': external_id(request.user),
              'email': request.user.email, 'username': f'gq_{request.user.pk}',
              'name': request.user.get_full_name() or f'Member {request.user.pk}',
              'require_activation': 'false',
              'admin': str(request.user.is_superuser).lower(),
              'moderator': str('graviquest-forum-moderators' in groups).lower(),
              'add_groups': ','.join(k for k, v in roles.items() if v in groups),
              'remove_groups': ','.join(k for k, v in roles.items() if v not in groups)}
    researcher = getattr(request.user, 'gravitas_researcher_profile', None)
    if researcher and researcher.avatar:
        fields['avatar_url'] = (settings.PUBLIC_BASE_URL.rstrip('/') +
                               '/api/forum/avatar/' + signing.dumps({'uid': request.user.pk}, salt='forum-avatar') + '/')
        fields['avatar_force_update'] = 'true'
    outbound = base64.b64encode(urlencode(fields).encode()).decode()
    sig = hmac.new(secret.encode(), outbound.encode(), hashlib.sha256).hexdigest()
    request.session.pop('forum_pending_sso', None)
    response = HttpResponseRedirect(base + '/session/sso_login?' + urlencode({'sso': outbound, 'sig': sig}))
    response.delete_cookie('gq_forum_continue')
    response['Referrer-Policy'] = 'no-referrer'
    return response


@require_GET
@never_cache
def forum_resume(request):
    pending = request.session.get('forum_pending_sso')
    if not pending:
        try:
            return HttpResponseRedirect(forum_url() + '/session/sso')
        except ForumUnavailable:
            return _unavailable()
    return HttpResponseRedirect('/api/forum/sso/?' + urlencode(pending))


@require_GET
@never_cache
def forum_avatar(request, token):
    from .platform_models import ResearcherProfile
    try:
        data = signing.loads(token, salt='forum-avatar', max_age=3600)
        profile = ResearcherProfile.objects.get(user_id=data['uid'], user__is_active=True)
        match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', profile.avatar)
        if not match:
            raise ValueError()
        body = base64.b64decode(match[2], validate=True)
        if len(body) > 256_000:
            raise ValueError()
    except (signing.BadSignature, ResearcherProfile.DoesNotExist, KeyError, ValueError):
        return HttpResponse(status=404)
    response = HttpResponse(body, content_type='image/' + match[1])
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response


def queue_logout(user):
    if user and user.pk and user.is_authenticated and settings.GRAVITAS_FORUM_URL:
        pending, _ = ForumLogout.objects.update_or_create(external_id=external_id(user), defaults={'user': user, 'attempts': 0})
        return pending


def revoke_forum_sessions(user):
    """Revoke by stable external ID, never by a supplied email or username."""
    from urllib.parse import quote
    key = settings.GRAVITAS_DISCOURSE_API_KEY
    if not key:
        raise ForumUnavailable()
    headers = {'Api-Key': key, 'Api-Username': settings.GRAVITAS_DISCOURSE_API_USERNAME,
               'Accept': 'application/json'}
    identity = user if isinstance(user, str) else external_id(user)
    if not re.fullmatch(r'graviquest:[0-9]{1,20}', identity):
        raise ForumUnavailable()
    try:
        response = requests.get(forum_url() + '/u/by-external/' + quote(identity, safe='') + '.json',
                                headers=headers, timeout=(2, 3), allow_redirects=False)
        if response.status_code == 404:
            return
        response.raise_for_status()
        uid = int(response.json()['user']['id'])
        response = requests.post(forum_url() + f'/admin/users/{uid}/log_out',
                                 headers=headers, timeout=(2, 3), allow_redirects=False)
        if response.status_code not in (200, 204):
            raise ForumUnavailable()
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        raise ForumUnavailable() from exc


@receiver(user_logged_out, dispatch_uid='graviquest_forum_logout')
def _on_logout(sender, request, user, **kwargs):
    if not user or not user.pk or not settings.GRAVITAS_FORUM_URL:
        return
    pending = queue_logout(user)
    try:
        revoke_forum_sessions(user)
    except ForumUnavailable:
        return  # The outbox worker retries without blocking the workspace.
    ForumLogout.objects.filter(pk=pending.pk, requested_at=pending.requested_at).delete()


@receiver(pre_delete, sender=get_user_model(), dispatch_uid='graviquest_forum_deleted_identity')
def _deleted_identity(sender, instance, **kwargs):
    if not settings.GRAVITAS_FORUM_URL:
        return
    identity = external_id(instance)
    # Keep the external ID after the Django account disappears, including when
    # Discourse is offline during an already authorized account deletion.
    pending, _ = ForumLogout.objects.update_or_create(external_id=identity,
                                                     defaults={'user': None, 'attempts': 0})
    def revoke_after_commit():
        try:
            revoke_forum_sessions(identity)
        except ForumUnavailable:
            return
        ForumLogout.objects.filter(pk=pending.pk, requested_at=pending.requested_at).delete()
    transaction.on_commit(revoke_after_commit)


def _schedule_revocation(user):
    # Wait for the GraviQuest access change to commit before revoking native
    # sessions. A later SSO refresh applies the now-authoritative group mapping.
    if settings.GRAVITAS_FORUM_URL:
        transaction.on_commit(lambda: _on_logout(None, None, user))


@receiver(pre_save, sender=get_user_model(), dispatch_uid='graviquest_forum_previous_admin')
def _previous_admin(sender, instance, update_fields=None, **kwargs):
    if settings.GRAVITAS_FORUM_URL and instance.pk and (update_fields is None or 'is_superuser' in update_fields):
        instance._forum_was_admin = sender.objects.filter(pk=instance.pk).values_list('is_superuser', flat=True).first()


@receiver(post_save, sender=get_user_model(), dispatch_uid='graviquest_forum_inactive_user')
def _inactive_user(sender, instance, **kwargs):
    was_admin = getattr(instance, '_forum_was_admin', False)
    if hasattr(instance, '_forum_was_admin'):
        del instance._forum_was_admin
    if not instance.is_active or (was_admin and not instance.is_superuser):
        _schedule_revocation(instance)


@receiver(post_save, sender=CommunityProfile, dispatch_uid='graviquest_forum_suspended_profile')
def _suspended_profile(sender, instance, **kwargs):
    if instance.status != CommunityProfile.Status.ACTIVE:
        _schedule_revocation(instance.user)


@receiver(m2m_changed, sender=get_user_model().groups.through, dispatch_uid='graviquest_forum_group_revocation')
def _forum_group_change(sender, instance, action, reverse, pk_set, **kwargs):
    names = ['graviquest-forum-researchers', 'graviquest-forum-reviewers', 'graviquest-forum-moderators']
    if reverse:
        if instance.name in names and action in ('pre_clear', 'post_remove'):
            users = instance.user_set.all() if action == 'pre_clear' else get_user_model().objects.filter(pk__in=pk_set or [])
            for user in users:
                _schedule_revocation(user)
        return
    if action == 'pre_clear' or action == 'post_remove':
        from django.contrib.auth.models import Group
        if action == 'pre_clear' or Group.objects.filter(pk__in=pk_set or [], name__in=names).exists():
            _schedule_revocation(instance)


@require_GET
@never_cache
def forum_logout_landing(request):
    # Native Discourse already revoked its own session. Require a CSRF-protected
    # POST for the Django session; never log a visitor out on a third-party GET.
    from django.middleware.csrf import get_token
    from django.utils.html import format_html
    token = get_token(request)
    return HttpResponse(format_html(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Sign out · GraviQuest</title><body><main><h1>Sign out of GraviQuest</h1>'
        '<p>You are signed out of the Forum. Finish signing out of your workspace below.</p>'
        '<form method="post" action="/api/forum/logout/"><input type="hidden" name="csrfmiddlewaretoken" value="{}">'
        '<button type="submit">Sign out of GraviQuest</button></form></main></body></html>', token))


@require_POST
@never_cache
def forum_logout(request):
    logout(request)
    return HttpResponseRedirect('/community')
