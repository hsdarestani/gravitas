from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

app_name = 'hq'

urlpatterns = [
    path('login/', auth_views.LoginView.as_view(template_name='hq/login.html', redirect_authenticated_user=True), name='login'),
    path('logout/', auth_views.LogoutView.as_view(next_page='/hq/login/'), name='logout'),
    path('', views.dashboard, name='dashboard'),
    path('search/', views.search, name='search'),
    path('strategy/', views.strategy, name='strategy'),
    path('strategy/new/', views.strategy_new, name='strategy_new'),
    path('strategy/<int:pk>/', views.strategy_edit, name='strategy_edit'),
    path('projects/', views.projects, name='projects'),
    path('projects/new/', views.project_new, name='project_new'),
    path('projects/<slug:slug>/', views.project_detail, name='project'),
    path('tasks/<int:pk>/status/', views.task_status, name='task_status'),
    path('content/', views.content, name='content'),
    path('content/create/<slug:project_slug>/', views.content_create, name='content_create'),
    path('content/<int:pk>/', views.content_edit, name='content_edit'),
    path('research/', views.research, name='research'),
    path('assets/', views.assets, name='assets'),
    path('team/', views.team, name='team'),
    path('team/<int:pk>/access/', views.team_access, name='team_access'),
]
