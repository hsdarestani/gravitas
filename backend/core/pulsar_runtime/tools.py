from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    skill: str
    risk: str
    action: str
    description: str


DEFAULT_TOOLS = (
    ToolDefinition('lms.read', 'learning', 'r0', 'read', 'Read course, lesson and learner progress context.'),
    ToolDefinition('learning.notes', 'learning', 'r1', 'write_interactions', 'Create learner notes/highlights or draft interactions.'),
    ToolDefinition('research.read', 'research', 'r0', 'read', 'Read research projects and ACL-visible resources.'),
    ToolDefinition('research.search', 'research', 'r0', 'read', 'Search ACL-visible research knowledge.'),
    ToolDefinition('files.read', 'research', 'r0', 'read', 'Read text from ACL-visible project resources.'),
    ToolDefinition('projects.read', 'project_task', 'r0', 'read', 'Read accessible project execution context.'),
    ToolDefinition('tasks.read', 'project_task', 'r0', 'read', 'Read accessible tasks.'),
    ToolDefinition('tasks.draft', 'project_task', 'r1', 'read', 'Prepare a task draft without committing a side effect.'),
    ToolDefinition('tasks.create', 'project_task', 'r2', 'write', 'Create a task after policy/approval checks.'),
)


class ToolRegistry:
    def __init__(self, tools: Iterable[ToolDefinition] = DEFAULT_TOOLS):
        self._tools = {tool.name: tool for tool in tools}

    def get(self, name):
        return self._tools.get(str(name or '').strip())

    def for_skill(self, skill_name):
        name = str(skill_name or '').strip().lower()
        return tuple(tool for tool in self._tools.values() if tool.skill == name)

    def allowed_names(self, *, skill_name, profile):
        scope = (profile or {}).get('permission_scope') or {}
        skill_scope = scope.get(skill_name) if isinstance(scope, dict) else {}
        skill_scope = skill_scope if isinstance(skill_scope, dict) else {}
        allowed = []
        for tool in self.for_skill(skill_name):
            if tool.action == 'read':
                permitted = skill_scope.get('read', True) is not False
            else:
                mode = skill_scope.get(tool.action, skill_scope.get('write', 'approval'))
                permitted = mode not in {False, 'deny', 'disabled'}
            if permitted:
                allowed.append(tool.name)
        return tuple(allowed)
