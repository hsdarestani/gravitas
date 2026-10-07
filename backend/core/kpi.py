from datetime import timedelta

from django.contrib.auth import get_user_model
from django.http import JsonResponse
from django.utils import timezone

from .models import Comment, LabProgress, NewsletterSubscriber

User = get_user_model()


def kpi_summary(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        return JsonResponse({'ok': False, 'error': 'staff_required'}, status=403)

    since = timezone.now() - timedelta(days=30)

    comment_users = set(
        Comment.objects.filter(created_at__gte=since)
        .values_list('author_id', flat=True)
        .distinct()
    )
    lab_users = set(
        LabProgress.objects.filter(updated_at__gte=since)
        .values_list('user_id', flat=True)
        .distinct()
    )
    empowered_users = comment_users | lab_users

    return JsonResponse({
        'ok': True,
        'window_days': 30,
        'monthly_empowered_participants': len(empowered_users),
        'registered_users_total': User.objects.filter(is_active=True).count(),
        'active_newsletter_subscribers': NewsletterSubscriber.objects.filter(is_active=True).count(),
        'comments_30d': Comment.objects.filter(created_at__gte=since).count(),
        'published_comments_total': Comment.objects.filter(status=Comment.Status.PUBLISHED).count(),
        'lab_participants_30d': len(lab_users),
        'lab_completions_30d': LabProgress.objects.filter(updated_at__gte=since, completed=True).count(),
        'completed_labs_total': LabProgress.objects.filter(completed=True).count(),
    })
