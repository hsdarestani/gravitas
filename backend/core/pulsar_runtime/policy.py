from dataclasses import dataclass

from .errors import PulsarApprovalRequired, PulsarPermissionError
from .profiles import assert_skill_allowed, snapshot
from .tools import ToolRegistry


DEFAULT_RISK_MODES = {
    'r0': 'auto',
    'r1': 'auto',
    'r2': 'approval',
    'r3': 'explicit',
    'r4': 'deny',
}


@dataclass(frozen=True)
class PolicyDecision:
    tool: str
    risk: str
    mode: str
    allowed: bool
    confirmed: bool


class ActionPolicy:
    """Server-side gate for Pulsar tools and side effects."""

    def __init__(self, tools=None):
        self.tools = tools or ToolRegistry()

    def decide(self, user, tool_name, *, confirmed=False):
        tool = self.tools.get(tool_name)
        if tool is None:
            raise PulsarPermissionError(f'unknown_pulsar_tool:{tool_name}')

        assert_skill_allowed(user, tool.skill)
        profile = snapshot(user)
        allowed_tools = set(self.tools.allowed_names(skill_name=tool.skill, profile=profile))
        if tool.name not in allowed_tools:
            raise PulsarPermissionError(f'pulsar_tool_not_allowed:{tool.name}')

        approvals = profile.get('approval_defaults') or {}
        mode = str(approvals.get(tool.risk) or DEFAULT_RISK_MODES.get(tool.risk, 'deny')).lower()
        if mode == 'deny':
            raise PulsarPermissionError(f'pulsar_tool_denied:{tool.name}')
        if mode in {'approval', 'explicit'} and not confirmed:
            raise PulsarApprovalRequired(f'pulsar_approval_required:{tool.name}')
        return PolicyDecision(
            tool=tool.name,
            risk=tool.risk,
            mode=mode,
            allowed=True,
            confirmed=bool(confirmed),
        )
