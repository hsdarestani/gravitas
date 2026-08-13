from django.contrib import admin
from django.urls import include, path

from core.content_api import content_page

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
    path('content/<slug:slug>/', content_page),
]
