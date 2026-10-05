class PulsarError(Exception):
    """Base error raised by the Pulsar runtime."""


class PulsarDecisionError(PulsarError):
    """Raised when a decision backend cannot produce a valid decision."""
