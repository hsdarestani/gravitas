"""Daily reporting reuses the linked private Telegram identity and shared service."""
from .operating_models import TelegramPulsarSession
from .work_report_models import DailyWorkReport
from .work_reports import decide, propose, interpret


def preview(report):
    lines = ['Pulsar · Suggested daily update', report.interpretation.get('summary', ''), '']
    for update in report.interpretation.get('updates', []):
        lines.extend([update['title'], f"Progress: {update['progress']}", f"Status suggestion: {update.get('status') or 'unchanged'}",
                      f"Deliverable: {update['deliverable']}", f"Blocker: {update['blocker']}", f"Next: {update['next_action']}", ''])
    if report.interpretation.get('unmatched_work'):
        lines.extend(['Unmatched work (no task will change):', report.interpretation['unmatched_work']])
    lines.append('Review before confirming. Tasks have not changed. /reportedit to choose tasks and edit.')
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
    if state.get('mode') in {'daily_report', 'daily_report_edit', 'daily_checkin'} and text.startswith('/cancel'):
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
    if text.startswith('/') and not text.startswith('/report'):
        return None
    if not text.startswith('/report') and not state.get('mode') == 'daily_checkin':
        return None
    value = text.split(maxsplit=1)[1] if text.startswith('/report') and len(text.split(maxsplit=1)) == 2 else ('' if text.startswith('/report') else text)
    if not value.strip():
        session.state = {'mode': 'daily_checkin'}; session.save(update_fields=['state', 'updated_at'])
        return [{'text': 'What did you work on today? Send a natural update. I will ask you to confirm before any task changes.'}]
    report = propose(user, value, source='telegram', source_key=source_key)
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
    return [{'text': f'Report {result.status}. ' + ('Task activity is recorded once.' if code == 'c' else 'No task changes.')}]
