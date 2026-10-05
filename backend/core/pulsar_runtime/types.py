from dataclasses import dataclass, field
from typing import Any, Dict, Optional
from uuid import uuid4


@dataclass(frozen=True)
class InvocationContext:
    run_id: str
    surface: str
    thread_id: Optional[str] = None
    user_id: Optional[str] = None
    workspace_id: Optional[str] = None
    locale: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        *,
        surface='unknown',
        thread_id=None,
        user_id=None,
        workspace_id=None,
        locale=None,
        metadata=None,
    ):
        return cls(
            run_id=uuid4().hex,
            surface=str(surface or 'unknown').strip().lower(),
            thread_id=str(thread_id) if thread_id is not None else None,
            user_id=str(user_id) if user_id is not None else None,
            workspace_id=str(workspace_id) if workspace_id is not None else None,
            locale=str(locale) if locale else None,
            metadata=dict(metadata or {}),
        )


@dataclass(frozen=True)
class ModelSelection:
    tier: str
    reason: str
    decision_source: str
    decision_model: Optional[str] = None


@dataclass(frozen=True)
class ProviderResponse:
    text: str
    provider: str
    model: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0


@dataclass(frozen=True)
class HarnessResult:
    text: str
    provider: str
    model: str
    model_tier: str
    skill: str
    run_id: str
    decision_source: str
    tools: tuple = ()
    profile_version: int = 0
    latency_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0
