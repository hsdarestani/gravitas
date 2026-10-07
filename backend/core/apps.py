from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Domain layers live in separate modules so the public CMS, research/KMS,
        # operating system and collaboration platform can evolve independently.
        from . import work_report_models  # noqa: F401
        from . import canonical_models  # noqa: F401
        from . import operating_models  # noqa: F401
        from . import platform_models  # noqa: F401
        from . import layer_models  # noqa: F401
        from . import lms_models  # noqa: F401
        from . import research_models  # noqa: F401
        from . import roadmap_models  # noqa: F401
        from . import space_models  # noqa: F401
        from . import oidc_models  # noqa: F401
        from . import kms_models  # noqa: F401
        from . import email_verification  # noqa: F401
        from . import layer_signals  # noqa: F401
        from . import space_fs
        from .space_project_metadata import project_markdown

        # Keep the filesystem engine generic while the project sidecar follows
        # the evolving project form schema. Every sync entry point resolves this
        # module-level formatter at call time.
        space_fs._project_markdown = project_markdown

        from . import platform_signals  # noqa: F401
        from . import space_signals  # noqa: F401
        # Roadmap execution is manager-driven. Do not register the legacy
        # membership/user signals that auto-materialized Roadmap tasks whenever
        # team identities changed.
        from .canonical_signals import install
        install()
        from . import operating_admin  # noqa: F401
