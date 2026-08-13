from django.urls import path
from core.views import health, newsletter_subscribe

urlpatterns = [
    path('health/', health),
    path('newsletter/subscribe/', newsletter_subscribe),
]
