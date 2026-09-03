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
        from . import space_models  # noqa: F401
        from . import oidc_models  # noqa: F401
        from . import email_verification  # noqa: F401
        from . import space_fs
        from .space_project_metadata import project_markdown

        # Keep the filesystem engine generic while the project sidecar follows
        # the evolving project form schema. Every sync entry point resolves this
        # module-level formatter at call time.
        space_fs._project_markdown = project_markdown

        # Project-internal folders are manager-defined. Older versions of the
        # platform seeded six fixed Collection folders (Client Input, Working,
        # Datasets, Analysis, Deliverables, Archive) for client/community/secure
        # projects. Keep the legacy constant available for compatibility, but
        # disable that automatic seeding for all newly created projects.
        from . import platform_api
        platform_api.PROJECT_FOLDERS = ()

        from . import platform_signals  # noqa: F401
        from . import space_signals  # noqa: F401
        from . import roadmap_assignment_signals  # noqa: F401
        from . import operating_admin  # noqa: F401
