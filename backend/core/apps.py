from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Operating models live in a separate module to keep the research/KMS
        # domain stable while the Gravitas operating layer evolves.
        from . import operating_models  # noqa: F401
