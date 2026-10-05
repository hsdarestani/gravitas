from dataclasses import dataclass
from typing import Iterable, Tuple


@dataclass(frozen=True)
class SkillDefinition:
    name: str
    description: str
    surfaces: Tuple[str, ...]
    capabilities: Tuple[str, ...]
    tools: Tuple[str, ...] = ()
    risk_ceiling: str = 'r0'
    requires_auth: bool = True


DEFAULT_SKILLS = (
    SkillDefinition(
        name='public',
        description='Public Gravitas navigation and published-content assistance.',
        surfaces=('public', 'website'),
        capabilities=('answer', 'navigate', 'explain_public_content'),
        requires_auth=False,
    ),
    SkillDefinition(
        name='learning',
        description='Learning assistant for course context, tutoring and learner continuity.',
        surfaces=('lms', 'learning'),
        capabilities=('tutor', 'explain', 'summarize', 'learning_context', 'notes'),
        tools=('lms.read', 'learning.notes'),
        risk_ceiling='r1',
    ),
    SkillDefinition(
        name='research',
        description='Research assistant for grounded retrieval, synthesis and research workflows.',
        surfaces=('research',),
        capabilities=('retrieve', 'synthesize', 'compare_sources', 'research_plan'),
        tools=('research.read', 'files.read', 'research.search'),
        risk_ceiling='r1',
    ),
    SkillDefinition(
        name='project_task',
        description='Project and execution capability used by Core, Projects and Telegram.',
        surfaces=('core', 'projects', 'telegram'),
        capabilities=('plan', 'extract_tasks', 'draft_task', 'project_context'),
        tools=('projects.read', 'tasks.read', 'tasks.draft'),
        risk_ceiling='r2',
    ),
    SkillDefinition(
        name='general',
        description='Safe default capability when a surface has no more specific skill.',
        surfaces=('unknown',),
        capabilities=('answer',),
        requires_auth=False,
    ),
)


class SkillRegistry:
    def __init__(self, skills: Iterable[SkillDefinition] = DEFAULT_SKILLS):
        self._skills = {skill.name: skill for skill in skills}

    def get(self, name):
        return self._skills.get(str(name or '').strip().lower())

    def resolve(self, *, name=None, surface='unknown'):
        if name:
            skill = self.get(name)
            if skill is None:
                raise KeyError(f'unknown_pulsar_skill:{name}')
            return skill

        surface = str(surface or 'unknown').strip().lower()
        for skill in self._skills.values():
            if surface in skill.surfaces:
                return skill
        return self._skills['general']

    def all(self):
        return tuple(self._skills.values())
