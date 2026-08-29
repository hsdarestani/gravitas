from django.contrib import admin
from django.urls import include, path

from core.content_api import content_page
from core.roadmap_okr import roadmap_okr_sync

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/operating/roadmap-sync/', roadmap_okr_sync),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
