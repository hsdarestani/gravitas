"""The reader's library: what somebody kept from the public site.

WHY THIS EXISTS AT ALL

An online shop lets you fill a basket before it asks who you are, and only
makes you sign up at the till. The public Gravitas+ archive works the same
way on purpose: a visitor can browse, keep an article, follow a topic and
tick off steps of a learning path without an account, because asking for an
email address before the visitor has decided the site is worth anything is
the fastest way to lose them. The account is what turns the pile into
something that survives the browser, moves between devices and appears in
the Knowledge workspace.

So the guest's pile lives in `localStorage` (see the reader library block in
`assets/production-bridge.js`) and this module is where it lands once there
is a user to attach it to. The first authenticated request POSTs the whole
local pile here; `merge()` is idempotent, so the adoption can be retried,
run twice from two tabs, or replayed after a failed sign-in without
duplicating a row or resurrecting something the reader has since removed.

WHY THE ROWS CARRY A SNAPSHOT RATHER THAN A FOREIGN KEY

Most of what is savable on the public site is static HTML — `dossiers`,
`topic-*`, `path-*` and the magazine entries are hand-authored pages, not
`ContentItem` rows. A saved item therefore cannot be a foreign key without
excluding most of the site, so the client sends the title, the URL and the
small `meta` bag the card was rendered from. The consequence to keep in
mind: a row here is what the reader saw when they saved it. If an article is
retitled, the library keeps the old title until the reader saves it again.
That is the honest reading of "saved", and it is also the only version that
works for a page with no database record.

WHY ONE TABLE FOR SAVING AND FOLLOWING

`ReaderSavedItem.relation` is `saved` or `following`. The two gestures mean
different things to the reader — one is "come back to this", the other is
"tell me about more of this" — but they need exactly the same columns, and
splitting them would have meant two models, two endpoints and two adoption
paths for what the client stores in one place.

WHY LEARNING-PATH PROGRESS IS NOT IN THAT TABLE

Progress is not an item; it is a set of ticked steps against an item. It
already has a home in `LabProgress`, which is a per-user keyed JSON blob with
the write validation this needs, so a path stores its progress there under
its own page slug (`path-ai-in-research`) with `state = {done: [...]}`. The
`PATH_KEY_PREFIX` convention is what lets this module read those rows back
without a second model and without picking up the interactive labs.
"""

import json
import re

from django.db import IntegrityError, transaction
from django.http import JsonResponse

from .models import LabProgress, ReaderSavedItem

# A learning path's progress is a LabProgress row keyed by the public page
# slug, which always begins this way. Labs use their own keys, so the prefix
# is what separates "paths I am partway through" from "labs I have played".
PATH_KEY_PREFIX = 'path-'

# Caps. Generous enough that no real reader meets them, small enough that a
# malformed or hostile client cannot turn the adoption endpoint into storage.
MAX_ROWS_PER_USER = 2000
MAX_ITEMS_PER_REQUEST = 300
MAX_PATHS_PER_REQUEST = 100
MAX_STEPS_PER_PATH = 200
MAX_META_BYTES = 4000

KEY_RE = re.compile(r'^[-a-zA-Z0-9_]{1,190}$')

RELATIONS = {choice for choice, _ in ReaderSavedItem.Relation.choices}
KINDS = {choice for choice, _ in ReaderSavedItem.Kind.choices}


def _payload(request):
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _item_json(item):
    return {
        'relation': item.relation,
        'kind': item.kind,
        'item_key': item.item_key,
        'url': item.url,
        'title': item.title,
        'summary': item.summary,
        'meta': item.meta,
        'saved_at': item.created_at.isoformat(),
    }


def _path_json(progress):
    state = progress.state if isinstance(progress.state, dict) else {}
    done = [step for step in state.get('done', []) if isinstance(step, str)]
    total = state.get('total')
    return {
        'item_key': progress.lab_key,
        'title': state.get('title', ''),
        'url': state.get('url', ''),
        'done': done,
        'total': total if isinstance(total, int) and total > 0 else len(done),
        'completed': bool(progress.completed),
        'updated_at': progress.updated_at.isoformat(),
    }


def _library_json(user):
    rows = list(ReaderSavedItem.objects.filter(user=user))
    paths = LabProgress.objects.filter(user=user, lab_key__startswith=PATH_KEY_PREFIX)
    return {
        'ok': True,
        'saved': [_item_json(row) for row in rows if row.relation == ReaderSavedItem.Relation.SAVED],
        'following': [_item_json(row) for row in rows if row.relation == ReaderSavedItem.Relation.FOLLOWING],
        'paths': [_path_json(progress) for progress in paths],
    }


class _Invalid(Exception):
    """A client sent something this module will not store.

    Raised rather than returned so the per-field checks can sit inline in the
    normalisers without every caller threading an error value back up.
    """

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _text(value, limit):
    if value is None:
        return ''
    if not isinstance(value, str):
        raise _Invalid('invalid_payload')
    return value.strip()[:limit]


def _normalise_item(raw, relation):
    if not isinstance(raw, dict):
        raise _Invalid('invalid_payload')

    key = raw.get('item_key') or raw.get('key') or ''
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise _Invalid('invalid_item_key')

    kind = raw.get('kind') or ReaderSavedItem.Kind.ARTICLE
    if kind not in KINDS:
        raise _Invalid('invalid_kind')

    meta = raw.get('meta') or {}
    if not isinstance(meta, dict):
        raise _Invalid('invalid_payload')
    if len(json.dumps(meta)) > MAX_META_BYTES:
        raise _Invalid('payload_too_large')

    title = _text(raw.get('title'), 240)
    if not title:
        raise _Invalid('title_required')

    return {
        'relation': relation,
        'item_key': key,
        'kind': kind,
        'url': _text(raw.get('url'), 300),
        'title': title,
        'summary': _text(raw.get('summary'), 2000),
        'meta': meta,
    }


def _normalise_path(raw):
    if not isinstance(raw, dict):
        raise _Invalid('invalid_payload')

    key = raw.get('item_key') or raw.get('key') or ''
    if not isinstance(key, str) or not KEY_RE.match(key) or not key.startswith(PATH_KEY_PREFIX):
        raise _Invalid('invalid_item_key')

    done = raw.get('done') or []
    if not isinstance(done, list) or len(done) > MAX_STEPS_PER_PATH:
        raise _Invalid('invalid_payload')
    steps = []
    for step in done:
        if not isinstance(step, str) or not KEY_RE.match(step):
            raise _Invalid('invalid_payload')
        if step not in steps:
            steps.append(step)

    total = raw.get('total')
    if total is not None and (not isinstance(total, int) or total < 0 or total > MAX_STEPS_PER_PATH):
        raise _Invalid('invalid_payload')

    return {
        'item_key': key,
        'done': steps,
        'total': total,
        'title': _text(raw.get('title'), 240),
        'url': _text(raw.get('url'), 300),
    }


def _merge_items(user, incoming):
    """Upsert the rows, keeping the earliest save date.

    `update_or_create` rather than `bulk_create(ignore_conflicts=True)`: a
    second save of the same article should refresh the snapshot, because the
    reader is looking at the current card, and a retitled piece would
    otherwise keep its stale title for ever.
    """
    written = 0
    for values in incoming:
        defaults = {key: value for key, value in values.items()
                    if key not in {'relation', 'item_key'}}
        try:
            with transaction.atomic():
                ReaderSavedItem.objects.update_or_create(
                    user=user,
                    relation=values['relation'],
                    item_key=values['item_key'],
                    defaults=defaults,
                )
        except IntegrityError:
            # Two tabs adopting the same pile at once. The row exists either
            # way, which is the whole point of an idempotent merge.
            continue
        written += 1
    return written


def _merge_paths(user, incoming):
    """Union the ticked steps rather than replace them.

    A guest who ticked steps 1-3 on their laptop and 4-5 on their phone, then
    signs in on both, means two POSTs carrying different subsets of the truth.
    Replacing would let the second one silently undo the first, so the server
    keeps the union and only the reader's explicit untick — which arrives as a
    DELETE of that path — removes anything.
    """
    for values in incoming:
        progress = LabProgress.objects.filter(user=user, lab_key=values['item_key']).first()
        state = progress.state if progress and isinstance(progress.state, dict) else {}
        done = [step for step in state.get('done', []) if isinstance(step, str)]

        if values.get('replace'):
            done = list(values['done'])
        else:
            for step in values['done']:
                if step not in done:
                    done.append(step)

        total = values['total'] or state.get('total') or len(done)
        merged = {
            'done': done[:MAX_STEPS_PER_PATH],
            'total': total,
            'title': values['title'] or state.get('title', ''),
            'url': values['url'] or state.get('url', ''),
        }
        LabProgress.objects.update_or_create(
            user=user,
            lab_key=values['item_key'],
            defaults={
                'state': merged,
                'completed': bool(total) and len(merged['done']) >= total,
            },
        )


def reader_library(request):
    """GET the library, POST a merge into it, DELETE one entry.

    One route for all three because the client has one store. The POST body is
    the same shape whether it carries one toggled article or a whole adopted
    guest pile, so `production-bridge.js` needs a single call and the adoption
    path is not a second code path that only runs once per reader and is
    therefore never exercised.
    """
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    if request.method == 'GET':
        return JsonResponse(_library_json(request.user))

    if request.method == 'DELETE':
        payload = _payload(request)
        if payload is None:
            return JsonResponse({'ok': False, 'error': 'invalid_payload'}, status=400)

        key = payload.get('item_key') or payload.get('key') or ''
        if not isinstance(key, str) or not KEY_RE.match(key):
            return JsonResponse({'ok': False, 'error': 'invalid_item_key'}, status=400)

        relation = payload.get('relation') or ReaderSavedItem.Relation.SAVED
        if relation == 'path':
            # A path is progress, not a saved row, so forgetting one means
            # dropping its LabProgress. Kept on this endpoint rather than
            # sending the reader to /api/lab/progress/ so the library has one
            # address from the client's point of view.
            LabProgress.objects.filter(user=request.user, lab_key=key).delete()
            return JsonResponse(_library_json(request.user))

        if relation not in RELATIONS:
            return JsonResponse({'ok': False, 'error': 'invalid_relation'}, status=400)

        ReaderSavedItem.objects.filter(
            user=request.user, relation=relation, item_key=key,
        ).delete()
        return JsonResponse(_library_json(request.user))

    if request.method not in {'POST', 'PUT'}:
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    if payload is None:
        return JsonResponse({'ok': False, 'error': 'invalid_payload'}, status=400)

    saved = payload.get('saved') or []
    following = payload.get('following') or []
    paths = payload.get('paths') or []
    if not isinstance(saved, list) or not isinstance(following, list) or not isinstance(paths, list):
        return JsonResponse({'ok': False, 'error': 'invalid_payload'}, status=400)
    if len(saved) + len(following) > MAX_ITEMS_PER_REQUEST or len(paths) > MAX_PATHS_PER_REQUEST:
        return JsonResponse({'ok': False, 'error': 'payload_too_large'}, status=413)

    try:
        items = (
            [_normalise_item(raw, ReaderSavedItem.Relation.SAVED) for raw in saved] +
            [_normalise_item(raw, ReaderSavedItem.Relation.FOLLOWING) for raw in following]
        )
        path_values = [_normalise_path(raw) for raw in paths]
    except _Invalid as invalid:
        status = 413 if invalid.code == 'payload_too_large' else 400
        return JsonResponse({'ok': False, 'error': invalid.code}, status=status)

    existing = ReaderSavedItem.objects.filter(user=request.user).count()
    fresh = {(values['relation'], values['item_key']) for values in items}
    held = set(
        ReaderSavedItem.objects.filter(user=request.user)
        .values_list('relation', 'item_key')
    )
    if existing + len(fresh - held) > MAX_ROWS_PER_USER:
        return JsonResponse({'ok': False, 'error': 'library_full'}, status=409)

    _merge_items(request.user, items)
    _merge_paths(request.user, path_values)
    return JsonResponse(_library_json(request.user))
