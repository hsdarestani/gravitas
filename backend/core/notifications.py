"""In-app notifications for everything that is not a task-board event.

The workspace already had one notification store, ``TaskInAppNotification``,
written by ``task_notifications`` for task assignment, edits, comments,
mentions and due reminders. Its name says "task" but its shape never did: the
task foreign key is nullable, ``event_type`` is free text and the link lives in
``payload['url']``. Pulsar reminders were already being written to it with no
task at all. So the rest of the site writes to the same table rather than to a
second one, and the reader gets a single feed in the workspace dock instead of
two lists that can disagree about what is unread.

What this module adds, and why each source is shaped the way it is:

- Public site comments notify on *publication*, not on submission. Every
  comment arrives as ``pending`` and waits for a moderator; announcing a reply
  or a mention before that would push text to someone that the site may never
  show. The author also hears that their comment went live, which is the only
  feedback moderation otherwise gives.
- Likes notify the comment's author once per liker. The event key is the
  comment and liker, so unliking and liking again does not ring twice.
- Core content cards notify their owner, their creator and everyone who
  already spoke on the card, the way a thread does.
- Mentions in free text are resolved against a *closed* candidate set — the
  people in that thread, or the Core members of that workspace — and only when
  the handle matches exactly one person. Usernames here are email addresses,
  so ``@`` followed by a first name or an email local part is what people
  actually type; an ambiguous handle notifies nobody rather than the wrong
  person, and a mention can never reach someone who cannot open what they were
  mentioned in.

These rows are in-app only. Email and Telegram stay limited to task events,
where the preference toggles in Settings already describe what they send.
"""

import functools
import logging
import re

from django.conf import settings

from .operating_models import TaskInAppNotification

logger = logging.getLogger(__name__)


def _never_raises(fn):
    """A notification that fails must not fail the comment or the moderation."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            logger.exception('Notification hook %s failed', fn.__name__)
            return 0
    return wrapper

MENTION_RE = re.compile(r'(?<![\w@])@([\w][\w.\-]*)', re.UNICODE)

# Discussion keys that are not a topic slug, and the page that hosts them.
SITE_COMMENT_PAGES = {
    'thought-experiment': '/community.html',
    'weekly-thought-experiment': '/community.html',
}


def _name(user):
    if not user:
        return 'Gravitas+'
    return user.get_full_name() or user.first_name or (user.email or '').split('@')[0] or user.get_username()


def _absolute(path):
    return settings.PUBLIC_BASE_URL.rstrip('/') + path


def _preview(text, limit=240):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[:limit - 1] + '…'


def notify(recipient, *, event_key, event_type, title, body='', url='', actor=None, task=None, extra=None):
    """Write one in-app notification. Returns 1 if a new row was made.

    ``event_key`` is unique per recipient, so calling this twice for the same
    event is harmless. The actor never notifies themselves.
    """
    if not recipient or not recipient.is_active:
        return 0
    if actor is not None and actor.pk == recipient.pk:
        return 0
    payload = {'url': url} if url else {}
    payload.update(extra or {})
    try:
        _, made = TaskInAppNotification.objects.get_or_create(
            recipient=recipient,
            event_key=event_key[:120],
            defaults={
                'actor': actor,
                'task': task,
                'event_type': event_type[:80],
                'title': title[:300],
                'body': body,
                'payload': payload,
            },
        )
    except Exception:
        logger.exception('Could not write notification event=%s recipient=%s', event_key, recipient.pk)
        return 0
    return int(made)


def _handles(user):
    keys = set()
    email = (user.email or '').strip().lower()
    if email:
        keys.add(email.split('@')[0])
    first = (user.first_name or '').strip().lower()
    last = (user.last_name or '').strip().lower()
    if first and ' ' not in first:
        keys.add(first)
    full = ''.join((user.get_full_name() or '').lower().split())
    if full:
        keys.add(full)
    if first and last:
        keys.add(f'{first}.{last}'.replace(' ', ''))
    return {key for key in keys if key}


def mentioned_users(text, candidates):
    """Users from ``candidates`` that ``text`` mentions unambiguously."""
    tokens = {match.rstrip('.-').lower() for match in MENTION_RE.findall(str(text or ''))}
    tokens.discard('')
    if not tokens:
        return []
    owners = {}
    for user in candidates:
        if not user or not user.is_active:
            continue
        for key in _handles(user):
            owners.setdefault(key, {})[user.pk] = user
    found = {}
    for token in tokens:
        matches = owners.get(token) or {}
        if len(matches) == 1:
            user = next(iter(matches.values()))
            found[user.pk] = user
    return list(found.values())


# ---------------------------------------------------------------------------
# Public site discussion
# ---------------------------------------------------------------------------

def site_comment_url(content_key):
    return _absolute(SITE_COMMENT_PAGES.get(content_key) or f'/topic.html?slug={content_key}')


@_never_raises
def notify_site_comment_published(comment, moderator=None):
    """A moderator just made ``comment`` public: tell the people it concerns."""
    from .models import Comment

    author = comment.author
    url = site_comment_url(comment.content_key)
    preview = _preview(comment.body)
    extra = {'comment_id': comment.pk, 'content_key': comment.content_key, 'source': 'site'}
    created = 0

    created += notify(
        author,
        event_key=f'site-comment-published:{comment.pk}',
        event_type='site.comment_published',
        title='Your comment is live',
        body=preview,
        url=url,
        actor=moderator,
        extra=extra,
    )

    told = {author.pk}
    parent = comment.parent
    if parent and parent.author_id not in told:
        created += notify(
            parent.author,
            event_key=f'site-comment-reply:{comment.pk}',
            event_type='site.comment_reply',
            title=f'{_name(author)} replied to your comment',
            body=preview,
            url=url,
            actor=author,
            extra=extra,
        )
        told.add(parent.author_id)

    participants = {
        row.author_id: row.author
        for row in (
            Comment.objects
            .filter(content_key=comment.content_key, status=Comment.Status.PUBLISHED)
            .select_related('author')
        )
    }
    for user in mentioned_users(comment.body, participants.values()):
        if user.pk in told:
            continue
        created += notify(
            user,
            event_key=f'site-comment-mention:{comment.pk}',
            event_type='site.mentioned',
            title=f'{_name(author)} mentioned you in a discussion',
            body=preview,
            url=url,
            actor=author,
            extra=extra,
        )
        told.add(user.pk)
    return created


@_never_raises
def notify_site_comment_liked(comment, liker):
    return notify(
        comment.author,
        event_key=f'site-comment-like:{comment.pk}:{liker.pk}',
        event_type='site.comment_liked',
        title=f'{_name(liker)} liked your comment',
        body=_preview(comment.body),
        url=site_comment_url(comment.content_key),
        actor=liker,
        extra={'comment_id': comment.pk, 'content_key': comment.content_key, 'source': 'site'},
    )


# ---------------------------------------------------------------------------
# Core content pipeline
# ---------------------------------------------------------------------------

@_never_raises
def notify_content_work_comment(item, comment):
    """A comment on a Core content card: mentions first, then the thread."""
    from .models import WorkspaceMembership

    author = comment.author
    url = _absolute('/workspace/core/content')
    preview = _preview(comment.body)
    extra = {'content_item_id': item.pk, 'comment_id': comment.pk, 'source': 'core-content'}
    members = [
        row.user
        for row in WorkspaceMembership.objects.filter(workspace=item.workspace).select_related('user')
    ]
    member_ids = {user.pk for user in members}
    created = 0
    told = {author.pk}

    for user in mentioned_users(comment.body, members):
        if user.pk in told:
            continue
        created += notify(
            user,
            event_key=f'content-mention:{comment.pk}',
            event_type='content.mentioned',
            title=f'{_name(author)} mentioned you on {item.title}',
            body=preview,
            url=url,
            actor=author,
            extra=extra,
        )
        told.add(user.pk)

    thread = {}
    for user in (item.owner, item.created_by):
        if user:
            thread[user.pk] = user
    for row in item.comments.select_related('author').exclude(pk=comment.pk):
        thread[row.author_id] = row.author
    for user in thread.values():
        # Someone who has since left Core does not keep hearing about its cards.
        if user.pk in told or user.pk not in member_ids:
            continue
        created += notify(
            user,
            event_key=f'content-comment:{comment.pk}',
            event_type='content.comment_added',
            title=f'New comment on {item.title}',
            body=f'{_name(author)}: {preview}',
            url=url,
            actor=author,
            extra=extra,
        )
        told.add(user.pk)
    return created
