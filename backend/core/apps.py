from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Domain layers live in separate modules so the public CMS, research/KMS,
        # operating system and collaboration platform can evolve independently.
        from . import operating_models  # noqa: F401
        from . import platform_models  # noqa: F401
        from . import roadmap_models  # noqa: F401
        from . import platform_signals  # noqa: F401
        from . import operating_admin  # noqa: F401
