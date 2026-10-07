class PulsarError(Exception):
    """Base error raised by the Pulsar runtime."""


class PulsarDecisionError(PulsarError):
    """Raised when a decision backend cannot produce a valid decision."""


class PulsarPermissionError(PulsarError):
    """Raised when a user memory/profile or live policy blocks a Pulsar capability."""


class PulsarApprovalRequired(PulsarPermissionError):
    """Raised when a Pulsar tool needs user approval before execution."""
