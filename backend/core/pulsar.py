"""Backward-compatible Pulsar facade.

The runtime lives in :mod:`core.pulsar_runtime`. Existing imports keep working
while Website, Telegram, LMS and future surfaces move onto the same Harness.
"""

from .pulsar_runtime import (
    PLATFORM_CONTEXT,
    HarnessResult,
    PulsarError,
    PulsarPermissionError,
    PulsarHarness,
    complete,
    configured,
    default_harness,
    run_text,
)

__all__ = [
    'PLATFORM_CONTEXT',
    'HarnessResult',
    'PulsarError',
    'PulsarPermissionError',
    'PulsarHarness',
    'complete',
    'configured',
    'default_harness',
    'run_text',
]
