from .errors import PulsarDecisionError, PulsarError, PulsarPermissionError
from .harness import PulsarHarness
from .types import HarnessResult


PLATFORM_CONTEXT = """Gravitas+ is a connected research and learning platform.
Public: Topics combine video, essays, sources, timelines, simulations, viewpoints and discussion.
Dashboard: a member sees saved material, discussions, progress, learning and research in one account.
Learning/LMS: course catalog, enrolled courses, certificates, progress and a saved Library.
Research: projects, milestones, tasks, notes, sources, datasets, files, mind maps, discussions, experiments, activity and search.
Core: authorized team members coordinate operating work, content, research administration, tasks, links and activity.
Knowledge/Space: research notes and files stay connected to projects and can synchronize with private cloud storage.
Pulsar is the shared multi-capability learning and research assistant for Gravitas+.
Its surfaces share one runtime; skills, context and permissions determine what it may do.
Pulsar should be concise, transparent about uncertainty and never invent private data or capabilities."""


default_harness = PulsarHarness()


def configured():
    return default_harness.configured()


def run_text(
    *,
    system,
    user,
    max_tokens=900,
    temperature=0.2,
    surface='unknown',
    skill=None,
    operation='chat',
    thread_id=None,
    user_id=None,
    workspace_id=None,
    locale=None,
    metadata=None,
    actor=None,
):
    return default_harness.run_text(
        system=system,
        user=user,
        max_tokens=max_tokens,
        temperature=temperature,
        surface=surface,
        skill=skill,
        operation=operation,
        thread_id=thread_id,
        user_id=user_id,
        workspace_id=workspace_id,
        locale=locale,
        metadata=metadata,
        actor=actor,
    )


def complete(
    *,
    system,
    user,
    max_tokens=900,
    temperature=0.2,
    surface='unknown',
    skill=None,
    operation='chat',
    thread_id=None,
    user_id=None,
    workspace_id=None,
    locale=None,
    metadata=None,
    actor=None,
):
    """Compatibility text-only API used by existing Pulsar callers."""
    return run_text(
        system=system,
        user=user,
        max_tokens=max_tokens,
        temperature=temperature,
        surface=surface,
        skill=skill,
        operation=operation,
        thread_id=thread_id,
        user_id=user_id,
        workspace_id=workspace_id,
        locale=locale,
        metadata=metadata,
        actor=actor,
    ).text


__all__ = [
    'PLATFORM_CONTEXT',
    'HarnessResult',
    'PulsarDecisionError',
    'PulsarError',
    'PulsarPermissionError',
    'PulsarHarness',
    'complete',
    'configured',
    'default_harness',
    'run_text',
]
