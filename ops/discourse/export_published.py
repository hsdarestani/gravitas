"""Executed read-only with the existing backend environment on the host."""
import importlib.util
import json
from pathlib import Path
import django
django.setup()
# The currently deployed backend may predate this integration. Load the same
# pure manifest helper from the reviewed source without replacing its app code.
path = Path(__file__).resolve().parents[2]/'backend/core/forum_content.py'
spec = importlib.util.spec_from_file_location('graviquest_forum_content_export',path)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
print(json.dumps(module.published_manifest()))
