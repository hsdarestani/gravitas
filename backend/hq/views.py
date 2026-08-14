from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from .access import access_level, can_manage_project, has_access, hq_access, member_for, visible_projects
from .forms import AssetReferenceForm, ContentProductionForm, EvidenceSourceForm, ProjectForm, StrategyDocumentForm, TaskForm
from .models import (
    AssetReference,
    ContentProduction,
    EvidenceSource,
    Project,
    SectionAccess,
    StrategyDocument,
    Task,
    TeamMember,
)


NAV = [
    ('dashboard', 'Command Center', SectionAccess.Section.DASHBOARD),
    ('strategy', 'Strategy', SectionAccess.Section.STRATEGY),
    ('projects', 'Projects', SectionAccess.Section.PROJECTS),
    ('content', 'Content Studio', SectionAccess.Section.CONTENT),
    ('research', 'Research', SectionAccess.Section.RESEARCH),
    ('assets', 'Assets', SectionAccess.Section.ASSETS),
    ('team', 'Team', SectionAccess.Section.TEAM),
]


def hq_render(request, template, context=None, active='dashboard'):
    context = dict(context or {})
    context.update({
        'hq_active': active,
        'hq_member': member_for(request.user),
        'hq_nav': [
            {'key': key, 'label': label, 'allowed': has_access(request.user, section), 'url': f'hq:{key}'}
            for key, label, section in NAV
        ],
    })
    return render(request, template, context)


@hq_access(SectionAccess.Section.DASHBOARD)
def dashboard(request):
    projects = visible_projects(request.user).exclude(status=Project.Status.ARCHIVED)
    member = member_for(request.user)
    task_query = Task.objects.filter(project__in=projects).exclude(status=Task.Status.DONE)
    if member and not request.user.is_superuser:
        task_query = task_query.filter(Q(assignee=member) | Q(project__owner=member)).distinct()
    context = {
        'project_count': projects.count(),
        'active_project_count': projects.filter(status=Project.Status.ACTIVE).count(),
        'blocked_project_count': projects.filter(status=Project.Status.BLOCKED).count(),
        'open_task_count': Task.objects.filter(project__in=projects).exclude(status=Task.Status.DONE).count(),
        'my_tasks': task_query.select_related('project', 'assignee')[:10],
        'recent_content': ContentProduction.objects.filter(project__in=projects).select_related('project', 'public_content').order_by('-updated_at')[:6],
        'strategy_docs': StrategyDocument.objects.filter(status=StrategyDocument.Status.ACTIVE).order_by('kind', 'title')[:6] if has_access(request.user, SectionAccess.Section.STRATEGY) else [],
    }
    return hq_render(request, 'hq/dashboard.html', context)


@hq_access(SectionAccess.Section.STRATEGY)
def strategy(request):
    docs = StrategyDocument.objects.select_related('owner').all()
    return hq_render(request, 'hq/strategy.html', {'documents': docs}, active='strategy')


@hq_access(SectionAccess.Section.STRATEGY, SectionAccess.Level.EDIT)
def strategy_new(request):
    form = StrategyDocumentForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        obj = form.save(commit=False)
        obj.updated_by = member_for(request.user)
        obj.save()
        messages.success(request, 'Strategy document created.')
        return redirect('hq:strategy_edit', pk=obj.pk)
    return hq_render(request, 'hq/form.html', {'form': form, 'title': 'New strategy document', 'eyebrow': 'Strategy'}, active='strategy')


@hq_access(SectionAccess.Section.STRATEGY)
def strategy_edit(request, pk):
    obj = get_object_or_404(StrategyDocument, pk=pk)
    can_edit = has_access(request.user, SectionAccess.Section.STRATEGY, SectionAccess.Level.EDIT)
    if request.method == 'POST' and not can_edit:
        raise PermissionDenied
    form = StrategyDocumentForm(request.POST or None, instance=obj)
    if request.method == 'POST' and form.is_valid():
        obj = form.save(commit=False)
        obj.updated_by = member_for(request.user)
        obj.version += 1
        obj.save()
        messages.success(request, f'Saved version {obj.version}.')
        return redirect('hq:strategy_edit', pk=obj.pk)
    for field in form.fields.values():
        field.disabled = not can_edit
    return hq_render(request, 'hq/form.html', {'form': form, 'title': obj.title, 'eyebrow': f'{obj.get_kind_display()} · v{obj.version}', 'object': obj}, active='strategy')


@hq_access(SectionAccess.Section.PROJECTS)
def projects(request):
    qs = visible_projects(request.user).select_related('owner', 'objective').annotate(open_tasks=Count('tasks', filter=~Q(tasks__status=Task.Status.DONE)))
    return hq_render(request, 'hq/projects.html', {'projects': qs}, active='projects')


@hq_access(SectionAccess.Section.PROJECTS, SectionAccess.Level.EDIT)
def project_new(request):
    form = ProjectForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        project = form.save()
        member = member_for(request.user)
        if member and not project.owner:
            project.owner = member
            project.save(update_fields=['owner'])
        messages.success(request, 'Project created.')
        return redirect('hq:project', slug=project.slug)
    return hq_render(request, 'hq/form.html', {'form': form, 'title': 'New project', 'eyebrow': 'Projects'}, active='projects')


@hq_access(SectionAccess.Section.PROJECTS)
def project_detail(request, slug):
    project = get_object_or_404(visible_projects(request.user).select_related('owner', 'objective'), slug=slug)
    can_manage = can_manage_project(request.user, project)
    task_form = TaskForm(request.POST or None)
    task_form.fields['milestone'].queryset = project.milestones.all()
    if request.method == 'POST':
        if not can_manage:
            raise PermissionDenied
        if task_form.is_valid():
            task = task_form.save(commit=False)
            task.project = project
            task.save()
            messages.success(request, 'Task added.')
            return redirect('hq:project', slug=project.slug)
    tasks = project.tasks.select_related('assignee', 'milestone').all()
    board = [(value, label, tasks.filter(status=value)) for value, label in Task.Status.choices]
    production = ContentProduction.objects.filter(project=project).first()
    return hq_render(request, 'hq/project_detail.html', {
        'project': project,
        'board': board,
        'task_form': task_form,
        'can_manage': can_manage,
        'production': production,
    }, active='projects')


@hq_access(SectionAccess.Section.PROJECTS, SectionAccess.Level.EDIT)
def task_status(request, pk):
    if request.method != 'POST':
        raise Http404
    task = get_object_or_404(Task.objects.select_related('project'), pk=pk)
    if not visible_projects(request.user).filter(pk=task.project_id).exists() or not can_manage_project(request.user, task.project):
        raise PermissionDenied
    status = request.POST.get('status')
    valid = {value for value, _ in Task.Status.choices}
    if status not in valid:
        raise Http404
    task.status = status
    task.save(update_fields=['status', 'updated_at'])
    return redirect('hq:project', slug=task.project.slug)


@hq_access(SectionAccess.Section.CONTENT)
def content(request):
    projects_qs = visible_projects(request.user)
    productions = ContentProduction.objects.filter(project__in=projects_qs).select_related('project', 'public_content').order_by('stage', 'planned_publish_at')
    return hq_render(request, 'hq/content.html', {'productions': productions}, active='content')


@hq_access(SectionAccess.Section.CONTENT, SectionAccess.Level.EDIT)
def content_create(request, project_slug):
    project = get_object_or_404(visible_projects(request.user), slug=project_slug)
    production, _ = ContentProduction.objects.get_or_create(project=project, defaults={'working_title': project.name})
    return redirect('hq:content_edit', pk=production.pk)


@hq_access(SectionAccess.Section.CONTENT)
def content_edit(request, pk):
    production = get_object_or_404(ContentProduction.objects.select_related('project', 'public_content'), pk=pk)
    if not visible_projects(request.user).filter(pk=production.project_id).exists():
        raise PermissionDenied
    can_edit = has_access(request.user, SectionAccess.Section.CONTENT, SectionAccess.Level.EDIT) and can_manage_project(request.user, production.project)
    if request.method == 'POST' and not can_edit:
        raise PermissionDenied
    form = ContentProductionForm(request.POST or None, instance=production)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Content production updated.')
        return redirect('hq:content_edit', pk=production.pk)
    for field in form.fields.values():
        field.disabled = not can_edit
    return hq_render(request, 'hq/content_edit.html', {'form': form, 'production': production, 'can_edit': can_edit}, active='content')


@hq_access(SectionAccess.Section.RESEARCH)
def research(request):
    sources = EvidenceSource.objects.select_related('added_by').all()[:100]
    form = EvidenceSourceForm(request.POST or None)
    if request.method == 'POST':
        if not has_access(request.user, SectionAccess.Section.RESEARCH, SectionAccess.Level.EDIT):
            raise PermissionDenied
        if form.is_valid():
            obj = form.save(commit=False)
            obj.added_by = member_for(request.user)
            obj.save()
            messages.success(request, 'Evidence source added.')
            return redirect('hq:research')
    return hq_render(request, 'hq/research.html', {'sources': sources, 'form': form}, active='research')


@hq_access(SectionAccess.Section.ASSETS)
def assets(request):
    projects_qs = visible_projects(request.user)
    assets_qs = AssetReference.objects.filter(Q(project__in=projects_qs) | Q(project__isnull=True)).select_related('project', 'production', 'created_by').distinct()[:120]
    form = AssetReferenceForm(request.POST or None)
    form.fields['project'].queryset = projects_qs
    form.fields['production'].queryset = ContentProduction.objects.filter(project__in=projects_qs)
    if request.method == 'POST':
        if not has_access(request.user, SectionAccess.Section.ASSETS, SectionAccess.Level.EDIT):
            raise PermissionDenied
        if form.is_valid():
            obj = form.save(commit=False)
            obj.created_by = member_for(request.user)
            obj.save()
            messages.success(request, 'External asset reference added. No binary was stored on this server.')
            return redirect('hq:assets')
    return hq_render(request, 'hq/assets.html', {'assets': assets_qs, 'form': form}, active='assets')


@hq_access(SectionAccess.Section.TEAM)
def team(request):
    members = TeamMember.objects.select_related('user').prefetch_related('section_access').all()
    return hq_render(request, 'hq/team.html', {'members': members, 'sections': SectionAccess.Section.choices, 'levels': SectionAccess.Level.choices}, active='team')


@hq_access(SectionAccess.Section.TEAM, SectionAccess.Level.MANAGE)
def team_access(request, pk):
    if request.method != 'POST':
        raise Http404
    member = get_object_or_404(TeamMember, pk=pk)
    valid_levels = {str(value) for value, _ in SectionAccess.Level.choices}
    for section, _ in SectionAccess.Section.choices:
        raw = request.POST.get(section)
        if raw not in valid_levels:
            continue
        SectionAccess.objects.update_or_create(member=member, section=section, defaults={'level': int(raw)})
    messages.success(request, f'Permissions updated for {member}.')
    return redirect('hq:team')
