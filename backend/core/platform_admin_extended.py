import json
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .layer_access import record_activity, set_module_grant
from .layer_models import ActivityEvent, ModuleGrant
from .lms_models import Certificate, CourseEnrollment
from .models import ProjectMembership, ResearchProject
from .platform_access import content_type_for, grant_role
from .platform_models import AccessGrant, ResearchProjectProfile
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


MAX_ROWS = 250


def _payload(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def _is_admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _deny(request):
    return JsonResponse(
        {'ok': False, 'error': 'authentication_required' if not request.user.is_authenticated else 'core_admin_required'},
        status=401 if not request.user.is_authenticated else 403,
    )


def _iso(value):
    return value.isoformat() if value else None


def _profile(project):
    profile, _ = ResearchProjectProfile.objects.get_or_create(
        project=project,
        defaults={'nextcloud_root': cloud.project_mountpoint(project)},
    )
    return profile


def _member_json(project, membership):
    user = membership.user
    return {
        'id': membership.pk,
        'user_id': user.pk,
        'email': user.email,
        'name': user.get_full_name() or user.get_username() or user.email,
        'role': membership.role,
        'project_owner': project.owner_id == user.pk,
        'created_at': _iso(membership.created_at),
    }


def _project_json(project, *, detail=False):
    profile = _profile(project)
    data = {
        'id': project.pk,
        'title': project.title,
        'description': project.description,
        'archived': project.archived,
        'owner': {
            'id': project.owner_id,
            'email': project.owner.email,
            'name': project.owner.get_full_name() or project.owner.get_username() or project.owner.email,
        },
        'category': profile.category,
        'visibility': profile.visibility,
        'status': profile.status,
        'research_question': profile.research_question,
        'client_name': profile.client_name,
        'confidentiality': profile.confidentiality,
        'deadline': profile.deadline.isoformat() if profile.deadline else None,
        'budget': str(profile.budget) if profile.budget is not None else None,
        'currency': profile.currency,
        'required_skills': profile.required_skills,
        'application_open': profile.application_open,
        'public_slug': profile.public_slug,
        'secure_data_room': profile.secure_data_room,
        'allow_public_links': profile.allow_public_links,
        'allow_downloads': profile.allow_downloads,
        'nextcloud_root': profile.nextcloud_root,
        'updated_at': _iso(project.updated_at),
    }
    if detail:
        memberships = project.memberships.select_related('user').order_by('user__email')
        data.update({
            'members': [_member_json(project, item) for item in memberships],
            'applications': [{
                'id': item.pk,
                'name': item.applicant_name,
                'email': item.applicant_email,
                'status': item.status,
                'skills': item.skills,
                'created_at': _iso(item.created_at),
            } for item in project.applications.all()[:100]],
            'counts': {
                'members': memberships.count(),
                'files': project.resources.count(),
                'folders': project.collections.count(),
                'applications': project.applications.count(),
                'deliverables': project.deliverables.count(),
            },
        })
    return data


@require_http_methods(['GET'])
def admin_research_projects(request):
    if not _is_admin(request):
        return _deny(request)
    qs = ResearchProject.objects.select_related('owner', 'platform_profile').all().order_by('-updated_at')
    query = str(request.GET.get('q') or '').strip()
    if query:
        qs = qs.filter(Q(title__icontains=query) | Q(description__icontains=query) | Q(owner__email__icontains=query))
    status = str(request.GET.get('status') or '').strip()
    if status:
        if status not in ResearchProjectProfile.Status.values:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        qs = qs.filter(platform_profile__status=status)
    category = str(request.GET.get('category') or '').strip()
    if category:
        if category not in ResearchProjectProfile.Category.values:
            return JsonResponse({'ok': False, 'error': 'invalid_category'}, status=400)
        qs = qs.filter(platform_profile__category=category)
    if request.GET.get('archived') != '1':
        qs = qs.filter(archived=False)
    return JsonResponse({'ok': True, 'projects': [_project_json(item) for item in qs[:MAX_ROWS]]})


def _decimal(value):
    if value in (None, ''):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('invalid_budget')


def _apply_project_fields(project, profile, data):
    changes = {}
    for field in ('title', 'description'):
        if field in data:
            value = str(data[field] or '').strip() if field == 'title' else str(data[field] or '')
            if field == 'title' and not value:
                raise ValueError('title_required')
            if getattr(project, field) != value:
                changes[field] = {'from': getattr(project, field), 'to': value}
                setattr(project, field, value)
    if 'archived' in data:
        value = bool(data['archived'])
        if project.archived != value:
            changes['archived'] = {'from': project.archived, 'to': value}
            project.archived = value

    choices = {
        'category': ResearchProjectProfile.Category.values,
        'visibility': ResearchProjectProfile.Visibility.values,
        'status': ResearchProjectProfile.Status.values,
        'confidentiality': ResearchProjectProfile.Confidentiality.values,
    }
    for field, allowed in choices.items():
        if field in data:
            value = str(data[field] or '')
            if value not in allowed:
                raise ValueError(f'invalid_{field}')
            if getattr(profile, field) != value:
                changes[field] = {'from': getattr(profile, field), 'to': value}
                setattr(profile, field, value)

    for field in ('research_question', 'client_name', 'requester_name', 'requester_email', 'currency', 'compensation_text'):
        if field in data:
            value = str(data[field] or '')
            if getattr(profile, field) != value:
                changes[field] = {'from': getattr(profile, field), 'to': value}
                setattr(profile, field, value)
    for field in ('application_open', 'secure_data_room', 'allow_public_links', 'allow_downloads'):
        if field in data:
            value = bool(data[field])
            if getattr(profile, field) != value:
                changes[field] = {'from': getattr(profile, field), 'to': value}
                setattr(profile, field, value)
    if 'budget' in data:
        value = _decimal(data.get('budget'))
        if profile.budget != value:
            changes['budget'] = {'from': str(profile.budget) if profile.budget is not None else None, 'to': str(value) if value is not None else None}
            profile.budget = value
    if 'required_skills' in data:
        value = data.get('required_skills')
        if not isinstance(value, list):
            raise ValueError('invalid_required_skills')
        profile.required_skills = [str(item).strip() for item in value if str(item).strip()][:100]
        changes['required_skills'] = profile.required_skills

    # A secure data room can never expose public links. Enforce this in the
    # control plane instead of waiting for a later share request to reject it.
    if profile.secure_data_room and profile.allow_public_links:
        profile.allow_public_links = False
        changes['allow_public_links'] = {'from': True, 'to': False}

    project.save()
    profile.save()
    return changes


def _resolve_user(raw):
    User = get_user_model()
    if not isinstance(raw, dict):
        raise ValueError('invalid_member')
    if raw.get('user_id') not in (None, ''):
        try:
            return User.objects.get(pk=int(raw['user_id']))
        except (User.DoesNotExist, TypeError, ValueError):
            raise ValueError('user_not_found')
    email = str(raw.get('email') or '').strip().lower()
    if not email:
        raise ValueError('member_user_required')
    user = User.objects.filter(email__iexact=email).first()
    if not user:
        raise ValueError('user_not_found')
    return user


def _apply_member(actor, project, raw):
    user = _resolve_user(raw)
    action = str(raw.get('action') or 'grant').strip().lower()
    if action == 'revoke':
        if user.pk == project.owner_id:
            raise ValueError('cannot_remove_project_owner')
        membership = ProjectMembership.objects.filter(project=project, user=user).first()
        ct = content_type_for(project)
        with transaction.atomic():
            if membership:
                membership.delete()
            AccessGrant.objects.filter(content_type=ct, object_id=project.pk, user=user).delete()
            try:
                nextcloud_bridge.remove_project_user(project, user)
            except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError) as exc:
                raise RuntimeError('cloud_membership_sync_failed') from exc
        return {'action': 'revoke', 'user_id': user.pk, 'email': user.email}

    role = str(raw.get('role') or ProjectMembership.Role.VIEWER).strip().lower()
    if role not in ProjectMembership.Role.values:
        raise ValueError('invalid_project_role')
    access_role = {
        ProjectMembership.Role.OWNER: 'manage',
        ProjectMembership.Role.EDITOR: 'edit',
        ProjectMembership.Role.VIEWER: 'view',
    }[role]
    with transaction.atomic():
        membership, _ = ProjectMembership.objects.update_or_create(project=project, user=user, defaults={'role': role})
        grant_role(project, user, access_role, granted_by=actor)
        set_module_grant(
            user,
            ModuleGrant.Module.RESEARCH,
            enabled=True,
            access_level=ModuleGrant.AccessLevel.EDIT if role in {ProjectMembership.Role.OWNER, ProjectMembership.Role.EDITOR} else ModuleGrant.AccessLevel.PARTICIPATE,
            source=ModuleGrant.Source.PROJECT,
            granted_by=actor,
            metadata={'project_id': project.pk, 'project_membership_id': membership.pk},
        )
        try:
            nextcloud_bridge.add_project_user(project, user)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError) as exc:
            raise RuntimeError('cloud_membership_sync_failed') from exc
    return {'action': 'grant', 'user_id': user.pk, 'email': user.email, 'role': role}


@require_http_methods(['GET', 'PATCH'])
def admin_research_project_detail(request, project_id):
    if not _is_admin(request):
        return _deny(request)
    project = ResearchProject.objects.select_related('owner').filter(pk=project_id).first()
    if not project:
        return JsonResponse({'ok': False, 'error': 'project_not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'project': _project_json(project, detail=True)})

    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    try:
        with transaction.atomic():
            project = ResearchProject.objects.select_for_update().select_related('owner').get(pk=project.pk)
            profile = _profile(project)
            changes = _apply_project_fields(project, profile, data)
        member_change = None
        if 'member' in data:
            member_change = _apply_member(request.user, project, data['member'])
            changes['member'] = member_change
    except ValueError as exc:
        code = str(exc)
        return JsonResponse({'ok': False, 'error': code}, status=404 if code == 'user_not_found' else (409 if code.startswith('cannot_') else 400))
    except RuntimeError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=503)

    if changes:
        record_activity(
            layer=ActivityEvent.Layer.RESEARCH,
            action='project.admin_updated',
            actor=request.user,
            object_type='research_project',
            object_id=project.pk,
            detail=changes,
        )
    return JsonResponse({'ok': True, 'project': _project_json(project, detail=True), 'changes': changes})


def _certificate_json(enrollment):
    try:
        cert = enrollment.certificate
    except Certificate.DoesNotExist:
        return None
    return {
        'code': str(cert.code),
        'issued_at': _iso(cert.issued_at),
        'revoked_at': _iso(cert.revoked_at),
        'valid': cert.revoked_at is None,
    }


def _enrollment_json(enrollment):
    user = enrollment.user
    return {
        'id': enrollment.pk,
        'user': {
            'id': user.pk,
            'email': user.email,
            'name': user.get_full_name() or user.get_username() or user.email,
        },
        'course': {
            'id': enrollment.course_id,
            'title': enrollment.course.title,
            'status': enrollment.course.status,
        },
        'status': enrollment.status,
        'access_source': enrollment.access_source,
        'progress_percent': str(enrollment.progress_percent),
        'enrolled_at': _iso(enrollment.enrolled_at),
        'completed_at': _iso(enrollment.completed_at),
        'certificate': _certificate_json(enrollment),
    }


@require_http_methods(['GET'])
def admin_lms_enrollments(request):
    if not _is_admin(request):
        return _deny(request)
    qs = CourseEnrollment.objects.select_related('user', 'course').all().order_by('-updated_at')
    course_id = request.GET.get('course_id')
    user_id = request.GET.get('user_id')
    status = str(request.GET.get('status') or '').strip()
    if course_id:
        try:
            qs = qs.filter(course_id=int(course_id))
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_course_id'}, status=400)
    if user_id:
        try:
            qs = qs.filter(user_id=int(user_id))
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_user_id'}, status=400)
    if status:
        if status not in CourseEnrollment.Status.values:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        qs = qs.filter(status=status)
    return JsonResponse({'ok': True, 'enrollments': [_enrollment_json(item) for item in qs[:MAX_ROWS]]})


@require_http_methods(['PATCH'])
def admin_lms_enrollment_detail(request, enrollment_id):
    if not _is_admin(request):
        return _deny(request)
    enrollment = CourseEnrollment.objects.select_related('user', 'course').filter(pk=enrollment_id).first()
    if not enrollment:
        return JsonResponse({'ok': False, 'error': 'enrollment_not_found'}, status=404)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)

    changes = {}
    with transaction.atomic():
        enrollment = CourseEnrollment.objects.select_for_update().select_related('user', 'course').get(pk=enrollment.pk)
        if 'status' in data:
            status = str(data['status'])
            if status not in CourseEnrollment.Status.values:
                return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
            if status != enrollment.status:
                changes['status'] = {'from': enrollment.status, 'to': status}
                enrollment.status = status
                if status == CourseEnrollment.Status.COMPLETED:
                    enrollment.completed_at = enrollment.completed_at or timezone.now()
                    enrollment.progress_percent = Decimal('100.00')
                    if enrollment.course.certificate_enabled:
                        Certificate.objects.get_or_create(enrollment=enrollment)
                elif status != CourseEnrollment.Status.COMPLETED:
                    enrollment.completed_at = None
                enrollment.save(update_fields=['status', 'completed_at', 'progress_percent', 'updated_at'])

        certificate_action = str(data.get('certificate') or '').strip().lower()
        if certificate_action:
            if certificate_action == 'reissue':
                cert, _ = Certificate.objects.get_or_create(enrollment=enrollment)
                cert.revoked_at = None
                cert.save(update_fields=['revoked_at'])
                changes['certificate'] = 'reissued'
            elif certificate_action == 'revoke':
                cert, _ = Certificate.objects.get_or_create(enrollment=enrollment)
                cert.revoked_at = timezone.now()
                cert.save(update_fields=['revoked_at'])
                changes['certificate'] = 'revoked'
            else:
                return JsonResponse({'ok': False, 'error': 'invalid_certificate_action'}, status=400)

        # A reactivated enrollment must always restore entry to Layer 3. A
        # revocation only disables an enrollment-sourced grant when there is no
        # other active/completed course; explicit administrator grants remain
        # independent.
        if enrollment.status in {CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.PAUSED, CourseEnrollment.Status.COMPLETED}:
            set_module_grant(
                enrollment.user,
                ModuleGrant.Module.LMS,
                enabled=True,
                access_level=ModuleGrant.AccessLevel.PARTICIPATE,
                source=ModuleGrant.Source.ENROLLMENT,
                granted_by=request.user,
                metadata={'course_id': enrollment.course_id, 'enrollment_id': enrollment.pk},
            )
        elif enrollment.status == CourseEnrollment.Status.REVOKED:
            grant = ModuleGrant.objects.filter(user=enrollment.user, module=ModuleGrant.Module.LMS).first()
            other = CourseEnrollment.objects.filter(
                user=enrollment.user,
                status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.PAUSED, CourseEnrollment.Status.COMPLETED],
            ).exclude(pk=enrollment.pk).exists()
            if grant and grant.source == ModuleGrant.Source.ENROLLMENT and not other:
                grant.enabled = False
                grant.granted_by = request.user
                grant.metadata = {'revoked_enrollment_id': enrollment.pk}
                grant.save(update_fields=['enabled', 'granted_by', 'metadata', 'updated_at'])

    if changes:
        record_activity(
            layer=ActivityEvent.Layer.LMS,
            action='enrollment.admin_updated',
            actor=request.user,
            subject_user=enrollment.user,
            object_type='course_enrollment',
            object_id=enrollment.pk,
            detail={'course_id': enrollment.course_id, **changes},
        )
    enrollment.refresh_from_db()
    return JsonResponse({'ok': True, 'enrollment': _enrollment_json(enrollment), 'changes': changes})
