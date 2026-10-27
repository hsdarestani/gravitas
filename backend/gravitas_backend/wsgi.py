"""WSGI entry point shared by local browser tests and standard Django servers."""
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravitas_backend.settings')
application = get_wsgi_application()
