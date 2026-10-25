"""Daily reporting reuses the linked private Telegram identity and shared service."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.conf import settings
from django.utils import timezone
from .operating_models import TelegramPulsarSession
from .work_report_models import DailyWorkReport
from .work_reports import decide, propose, interpret, report_day, parse_work_date_prefix, validate_work_date
from .telegram_pulsar import is_information_request


def _report_timestamp(moment):
    name = getattr(settings, 'GRAVITAS_DAILY_REPORT_TIMEZONE', 'Asia/Tehran')
    try:
        zone = ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError):
        zone = ZoneInfo('UTC')
    return timezone.localtime(moment, zone).strftime('%Y-%m-%d %H:%M') + ' (' + str(zone) + ')'


def preview(report):
    lines = [
        'Pulsar · Suggested daily update',
        'Work date: ' + report.report_date.isoformat(),
        'Submitted: ' + _report_timestamp(report.created_at),
        '',
        report.interpretation.get('summary', ''), '',
    ]
    updates = report.interpretation.get('updates', [])
    for update in updates:
        task_id = update.get('task_id')
        title = (
            f"Task #{task_id} · {update['title']}" if task_id
            else f"UNMATCHED (no task change) · {update['title']}"
        )
        lines.extend([
            title,
            f"Progress: {update['progress']}",
            f"Status suggestion: {update.get('status') or 'unchanged'}",
            f"Deliverable: {update['deliverable']}",
            f"Blocker: {update['blocker']}",
            f"Next: {update['next_action']}",
            '',
        ])
    unmatched = str(report.interpretation.get('unmatched_work') or '').strip()
    if unmatched and unmatched.casefold() not in {'none', 'no unmatched work reported', 'no unmatched work'}:
        lines.extend(['Unmatched work (no task will change):', unmatched])
    lines.append('Review exact task IDs before confirming. No task changed yet. /reportedit to correct; /reportpreview to review again.')
    return {'text': '\n'.join(lines)[:4096], 'reply_markup': {'inline_keyboard': [[
        {'text': 'Confirm', 'callback_data': f'wr:c:{report.pk.hex}:{report.revision}'},
        {'text': 'Edit', 'callback_data': f'wr:e:{report.pk.hex}:{report.revision}'},
        {'text': 'Cancel', 'callback_data': f'wr:x:{report.pk.hex}:{report.revision}'},
    ]]}}


def handle_report_message(user, text, source_key=None):
    session, _ = TelegramPulsarSession.objects.get_or_create(user=user)
    state = session.state or {}
    duplicate = DailyWorkReport.objects.filter(user=user, source='telegram', source_key=source_key).first() if source_key else None
    if duplicate:
        return [preview(duplicate)] if duplicate.status == 'pending' else [{'text': f'This report is already {duplicate.status}. No duplicate changes.'}]
    # A pending check-in can stay armed for hours. Do not hijack an
    # unrelated informational question as today's activity report.
    # The user can resume with an explicit /report command.
    if state.get('mode') in {'daily_checkin', 'daily_report_edit'} and is_information_request(text):
        session.state = {}
        session.save(update_fields=['state', 'updated_at'])
        return None
    if text.strip().lower() == '/reportpreview':
        report = DailyWorkReport.objects.filter(
            pk=state.get('report_id'), user=user, status='pending',
        ).first() if state.get('report_id') else None
        if not report:
            return [{'text': 'No active pending report. Use /report to prepare a new update.'}]
        return [preview(report)]
    if text.strip().lower() in {'/reports', '/reportlist'}:
        recent = DailyWorkReport.objects.filter(user=user).order_by('-created_at')[:10]
        if not recent:
            return [{'text': 'No work reports yet.'}]
        return [{'text': 'Recent reports (work date · submitted · status):\n' + '\n'.join(
            r.report_date.isoformat() + ' · ' + _report_timestamp(r.created_at) +
            ' · ' + r.status for r in recent
        )}]
    if state.get('mode') == 'daily_collect' and text.strip().lower() in {'/done', '/submit'}:
        parts = state.get('parts') or []
        if not parts:
            return [{'text': 'Send a work update first, or /cancel to leave this draft.'}]
        day = validate_work_date(state.get('report_date'), user)
        key = source_key or ('telegram-collect:' + str(session.pk))
        report = propose(user, '\n'.join(parts), source='telegram', source_key=key, report_date=day)
        session.state = {'mode': 'daily_report', 'report_id': str(report.pk)}
        session.save(update_fields=['state', 'updated_at'])
        return [preview(report)]
    if state.get('mode') == 'daily_collect' and not text.startswith('/'):
        # Unlike separate task requests, these messages intentionally form one
        # work-report context, without modifying any task until confirmation.
        if is_information_request(text):
            return None
        pieces = [*(state.get('parts') or []), text]
        if len(pieces) > 25 or len('\n'.join(pieces)) > 16000:
            return [{'text': 'This report is too long. Send /done to preview, or /cancel.'}]
        state['parts'] = pieces
        session.state = state
        session.save(update_fields=['state', 'updated_at'])
        return [{'text': f'Added to work report for {state["report_date"]} ({len(pieces)} messages). Send more details or /done to preview.'}]
    if text.startswith('/reportedit'):
        state['mode'] = 'daily_report_edit'; session.state = state; session.save(update_fields=['state', 'updated_at'])
        return [{'text': 'Describe the correction or name the matching task. I will show a new proposal to confirm. /cancel cancels this draft.'}]
    if state.get('mode') == 'daily_report_edit' and not text.startswith('/'):
        report = DailyWorkReport.objects.filter(pk=state.get('report_id'), user=user, status='pending').first()
        if not report:
            return [{'text': 'No pending report. Send /report followed by your update.'}]
        raw = interpret(user, 'Original report: ' + report.original_text + '\nCurrent proposal: ' + str(report.interpretation) + '\nUser correction: ' + text)
        report = decide(user, report.pk, report.revision, 'edit', raw)
        session.state = {'mode': 'daily_report', 'report_id': str(report.pk)}; session.save(update_fields=['state', 'updated_at'])
        return [preview(report)]
    if state.get('mode') in {'daily_report', 'daily_report_edit', 'daily_checkin', 'daily_collect'} and text.startswith('/cancel'):
        report = DailyWorkReport.objects.filter(pk=state.get('report_id'), user=user, status='pending').first()
        if report:
            decide(user, report.pk, report.revision, 'cancel')
        session.state = {}; session.save(update_fields=['state', 'updated_at'])
        return [{'text': 'Report cancelled. No task changes.'}]
    if state.get('mode') == 'daily_report' and text.strip().lower() in {'confirm', 'تایید', 'تأیید'}:
        report = DailyWorkReport.objects.filter(pk=state.get('report_id'), user=user).first()
        if not report:
            return [{'text': 'No pending report.'}]
        return handle_report_callback(user, f'wr:c:{report.pk.hex}:{report.revision}')
    if text.startswith('/') and not (text.startswith('/report ') or text in {'/report', '/reportmulti'} or text.startswith('/reportmulti ')):
        return None
    if not (text == '/report' or text.startswith('/report ') or text == '/reportmulti' or text.startswith('/reportmulti ')) and state.get('mode') != 'daily_checkin':
        return None
    explicit_report = text == '/report' or text.startswith('/report ') or text == '/reportmulti' or text.startswith('/reportmulti ')
    manual_collect = text == '/reportmulti' or text.startswith('/reportmulti ')
    value = text.split(maxsplit=1)[1] if explicit_report and len(text.split(maxsplit=1)) == 2 else ('' if explicit_report else text)
    try:
        day, work = parse_work_date_prefix(value, user)
    except ValueError as exc:
        return [{'text': f'Invalid work date: {exc}. Use YYYY-MM-DD, yesterday, or 2 days ago (up to one year back).'}]
    day = day or report_day(user)
    if manual_collect or (explicit_report and not work.strip() and day != report_day(user)):
        session.state = {'mode': 'daily_collect', 'report_date': day.isoformat(), 'parts': []}
        session.save(update_fields=['state', 'updated_at'])
        return [{'text': f'Work date: {day.isoformat()}. Send messages for this day, then /done for one combined preview. /cancel discards the draft.'}]
    if not work.strip():
        session.state = {'mode': 'daily_checkin'}
        session.save(update_fields=['state', 'updated_at'])
        return [{'text': f'Work date: {day.isoformat()}. What did you work on today? Send an update. To combine several messages, use /reportmulti YYYY-MM-DD and /done.'}]
    report = propose(user, work, source='telegram', source_key=source_key, report_date=day)
    session.state = {'mode': 'daily_report', 'report_id': str(report.pk)}
    session.save(update_fields=['state', 'updated_at'])
    if report.status != 'pending':
        return [{'text': f'This report is already {report.status}. No duplicate changes.'}]
    return [preview(report)]


def handle_report_callback(user, action):
    import uuid
    if action == 'wr:start':
        return handle_report_message(user, '/report')
    try:
        prefix, code, ident, revision = action.split(':')
        report_id = uuid.UUID(hex=ident)
        revision = int(revision)
    except (ValueError, AttributeError):
        return [{'text': 'Invalid report action.'}]
    if prefix != 'wr' or code not in {'c', 'e', 'x'}:
        return [{'text': 'Invalid report action.'}]
    report = DailyWorkReport.objects.filter(pk=report_id, user=user).first()
    if not report:
        return [{'text': 'Report not found.'}]
    if code == 'e':
        if report.status != 'pending' or report.revision != revision:
            return [{'text': 'This proposal has changed. Review its current version in Gravitas.'}]
        session, _ = TelegramPulsarSession.objects.get_or_create(user=user)
        session.state = {'mode': 'daily_report_edit', 'report_id': str(report.pk)}; session.save(update_fields=['state', 'updated_at'])
        return [{'text': 'Describe the correction or name the matching task. I will show a new proposal to confirm.'}]
    try:
        result = decide(user, report_id, revision, 'confirm' if code == 'c' else 'cancel')
    except (ValueError, PermissionError) as exc:
        return [{'text': f'Nothing applied: {exc}. Review the report in Gravitas.'}]
    TelegramPulsarSession.objects.filter(user=user, state__report_id=str(report_id)).update(state={})
    return [{'text': (
        f'Report {result.status}. Work date: {result.report_date.isoformat()}. '
        f'Recorded: {_report_timestamp(result.confirmed_at or timezone.now())}. '
        + ('Task activity is recorded once.' if code == 'c' else 'No task changes.')
    )}]
