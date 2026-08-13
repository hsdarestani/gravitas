from django.urls import path

from core.kpi import kpi_summary
from core.views import (
    auth_csrf,
    auth_login,
    auth_logout,
    auth_me,
    auth_signup,
    comments,
    health,
    lab_progress,
    newsletter_subscribe,
)

urlpatterns = [
    path('health/', health),
    path('newsletter/subscribe/', newsletter_subscribe),
    path('auth/csrf/', auth_csrf),
    path('auth/signup/', auth_signup),
    path('auth/login/', auth_login),
    path('auth/logout/', auth_logout),
    path('auth/me/', auth_me),
    path('community/comments/<slug:content_key>/', comments),
    path('lab/progress/<slug:lab_key>/', lab_progress),
    path('analytics/kpi/', kpi_summary),
]
