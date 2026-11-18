"""Course interest: "tell me when this opens", with a say in how keen.

Learn on the landing page is shown as under construction. A visitor can
still pick a course, say how interested they are and leave an email; the team
uses the tally to decide what to build first and writes to the confirmed
addresses when a course opens.

Why a confirmation email, when the newsletter already has one and this could
simply reuse it: the two lists mean different things. The newsletter is a
standing subscription; this is one message about one course, and somebody who
asked for that has not asked for a weekly letter. The same double opt-in rule
applies, because an address typed into a public form is not proof that its
owner wants mail. Until the link is followed the row says `confirmed=False`
and nobody writes to it.

The catalogue is fixed here rather than read from the LMS. The courses worth
asking about are the ones that do not exist yet, so there is no other record
to validate against, and accepting any slug would let the form fill the table
with junk. A course is added to `COURSES` in the same change that puts it on
the page.

Abuse is bounded the cheap way: a second request for the same course and
address inside `RESEND_AFTER` updates the level but sends no second email, so
the form cannot be used to mail someone repeatedly.
"""
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import CourseInterest
from .views import _payload, _send_system_email

COURSES = {
    'ai-in-research': 'AI Applications in Scientific Research',
    'computational-science': 'Computational Science',
    'philosophy-of-science': 'Philosophy of Science',
    'reading-a-paper': 'Reading a Paper Properly',
}
SIGNING_SALT = 'graviquest-course-interest-v1'
CONFIRM_MAX_AGE = 60 * 60 * 72
RESEND_AFTER = timedelta(hours=1)


def _send_confirmation(row):
    token = signing.dumps({'id': row.pk, 'email': row.email}, salt=SIGNING_SALT, compress=True)
    link = f"{settings.PUBLIC_BASE_URL}/api/learn/interest/confirm/?token={quote(token)}"
    title = COURSES[row.course]
    text = (
        f'You asked to hear when "{title}" opens on GraviQuest.\n\n'
        'Confirm your email within 72 hours and we will write to you once, when it is ready:\n'
        f'{link}\n\n'
        'If this was not you, ignore this email and nothing more will arrive.'
    )
    html = (
        f'<h2>{title} is on its way</h2>'
        '<p>You asked to hear when this course opens on GraviQuest. '
        'Confirm your email within 72 hours and we will write to you once, when it is ready.</p>'
        f'<p><a href="{link}">Confirm and keep my place</a></p>'
        '<p>If this was not you, ignore this email and nothing more will arrive.</p>'
    )
    _send_system_email(f'Keep your place: {title}', row.email, text, html)


@require_POST
def course_interest(request):
    payload = _payload(request)
    course = str(payload.get('course', '')).strip()
    email = str(payload.get('email', '')).strip().lower()
    try:
        level = int(payload.get('level', CourseInterest.Level.KEEN))
    except (TypeError, ValueError):
        level = -1
    if course not in COURSES:
        return JsonResponse({'ok': False, 'error': 'unknown_course'}, status=400)
    if level not in CourseInterest.Level.values:
        return JsonResponse({'ok': False, 'error': 'invalid_level'}, status=400)
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'ok': False, 'error': 'invalid_email'}, status=400)

    row, created = CourseInterest.objects.get_or_create(course=course, email=email, defaults={'level': level})
    if not created and row.level != level:
        row.level = level
        row.save(update_fields=['level', 'updated_at'])
    if row.confirmed:
        return JsonResponse({'ok': True, 'already_confirmed': True})

    now = timezone.now()
    if row.confirmation_sent_at and now - row.confirmation_sent_at < RESEND_AFTER:
        return JsonResponse({'ok': True, 'pending_confirmation': True})
    try:
        _send_confirmation(row)
    except Exception:
        return JsonResponse({'ok': False, 'error': 'email_delivery_failed'}, status=502)
    row.confirmation_sent_at = now
    row.save(update_fields=['confirmation_sent_at', 'updated_at'])
    return JsonResponse({'ok': True, 'pending_confirmation': True}, status=201 if created else 200)


@require_GET
def course_interest_confirm(request):
    base = settings.PUBLIC_BASE_URL
    try:
        data = signing.loads(request.GET.get('token', ''), salt=SIGNING_SALT, max_age=CONFIRM_MAX_AGE)
        row = CourseInterest.objects.get(pk=data.get('id'), email=str(data.get('email', '')).lower())
    except (signing.BadSignature, signing.SignatureExpired, CourseInterest.DoesNotExist):
        return HttpResponseRedirect(f'{base}/?interest=0#learn')
    if not row.confirmed:
        row.confirmed = True
        row.save(update_fields=['confirmed', 'updated_at'])
    return HttpResponseRedirect(f'{base}/?interest=1#learn')
