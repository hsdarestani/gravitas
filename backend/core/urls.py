from django.urls import path

from core.content_api import content_detail, content_list
from core.kpi import kpi_summary
from core.views import (
    auth_csrf,
    auth_export,
    auth_login,
    auth_logout,
    auth_me,
    auth_signup,
    comments,
    health,
    lab_progress,
    newsletter_confirm,
    newsletter_subscribe,
    password_reset_confirm,
    password_reset_request,
)

urlpatterns = [
    path('health/', health),
    path('content/', content_list),
    path('content/<slug:slug>/', content_detail),
    path('newsletter/subscribe/', newsletter_subscribe),
    path('newsletter/confirm/', newsletter_confirm),
    path('auth/csrf/', auth_csrf),
    path('auth/signup/', auth_signup),
    path('auth/login/', auth_login),
    path('auth/logout/', auth_logout),
    path('auth/me/', auth_me),
    path('auth/export/', auth_export),
    path('auth/password-reset/', password_reset_request),
    path('auth/password-reset/confirm/', password_reset_confirm),
    path('community/comments/<slug:content_key>/', comments),
    path('lab/progress/<slug:lab_key>/', lab_progress),
    path('analytics/kpi/', kpi_summary),
]
