from django.contrib import admin
from django.urls import include, path

from core.content_api import content_page
from core.mindmap_ai import generate_mindmap_ai
from core.roadmap_okr import roadmap_okr_sync

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/operating/roadmap-sync/', roadmap_okr_sync),
    path('api/platform/mindmaps/<int:map_id>/ai/', generate_mindmap_ai),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
