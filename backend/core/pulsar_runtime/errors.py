class PulsarError(Exception):
    """Base error raised by the Pulsar runtime."""


class PulsarProviderError(PulsarError):
    """Allowlisted diagnostics only: never retain provider bodies or prompts."""

    def __init__(self, code, *, provider='cloudflare-workers-ai', http_status=None,
                 provider_codes=(), retry_after=None):
        super().__init__(code)
        self.code = code
        self.provider = provider
        self.http_status = http_status if type(http_status) is int else None
        self.provider_codes = tuple(value for value in provider_codes if type(value) is int)[:4]
        self.retry_after = retry_after if type(retry_after) is int and 0 <= retry_after <= 86400 else None

    def diagnostics(self):
        return {'code': self.code, 'provider': self.provider,
                'http_status': self.http_status, 'provider_codes': list(self.provider_codes),
                'retry_after': self.retry_after}


class PulsarDecisionError(PulsarError):
    """Raised when a decision backend cannot produce a valid decision."""


class PulsarPermissionError(PulsarError):
    """Raised when a user memory/profile or live policy blocks a Pulsar capability."""


class PulsarApprovalRequired(PulsarPermissionError):
    """Raised when a Pulsar tool needs user approval before execution."""
