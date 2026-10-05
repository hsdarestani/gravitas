import json
import logging


logger = logging.getLogger('core.pulsar')


def emit(event, invocation, **fields):
    payload = {
        'event': str(event),
        'run_id': invocation.run_id,
        'surface': invocation.surface,
        'thread_id': invocation.thread_id,
        'user_id': invocation.user_id,
        'workspace_id': invocation.workspace_id,
    }
    payload.update({key: value for key, value in fields.items() if value is not None})
    logger.info('pulsar_trace %s', json.dumps(payload, ensure_ascii=False, default=str))
    return payload
