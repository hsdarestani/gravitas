from django.contrib import admin
from django.urls import include, path

from core.ai_runtime import generate_mindmap_ai_routed
from core.content_api import content_page
from core.roadmap_okr import roadmap_okr_sync

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/operating/roadmap-sync/', roadmap_okr_sync),
    path('api/platform/mindmaps/<int:map_id>/ai/', generate_mindmap_ai_routed),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
