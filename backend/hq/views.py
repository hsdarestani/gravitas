from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from .access import can_manage_project, has_access, hq_access, member_for, visible_projects
from .forms import AssetReferenceForm, ContentProductionForm, EvidenceSourceForm, ProjectForm, StrategyDocumentForm, TaskForm
from .models import (
    AssetReference,
    ContentProduction,
    EvidenceSource,
    Objective,
    Project,
    SectionAccess,
    StrategyDocument,
    Task,
    TeamMember,
)


ROADMAP_URL = 'https://gravitas-roadmap.pages.dev/'

NAV_GROUPS = [
    ('Home', [
        ('dashboard', 'Overview', SectionAccess.Section.DASHBOARD, 'home'),
    ]),
    ('Plan', [
        ('strategy', 'Strategy', SectionAccess.Section.STRATEGY, 'strategy'),
        ('projects', 'Projects & tasks', SectionAccess.Section.PROJECTS, 'projects'),
    ]),
    ('Create', [
        ('content', 'Content Studio', SectionAccess.Section.CONTENT, 'content'),
        ('research', 'Research & evidence', SectionAccess.Section.RESEARCH, 'research'),
        ('assets', 'Asset library', SectionAccess.Section.ASSETS, 'assets'),
    ]),
    ('Manage', [
        ('team', 'Team & access', SectionAccess.Section.TEAM, 'team'),
    ]),
]


def _navigation_for(user):
    groups = []
    for group_label, items in NAV_GROUPS:
        visible = []
        for key, label, section, icon in items:
            if has_access(user, section):
                visible.append({'key': key, 'label': label, 'url': f'hq:{key}', 'icon': icon})
        if visible:
            groups.append({'label': group_label, 'items': visible})
    return groups


def hq_render(request, template, context=None, active='dashboard'):
    context = dict(context or {})
    nav_groups = _navigation_for(request.user)
    active_label = 'Gravitas HQ'
    for group in nav_groups:
        for item in group['items']:
            if item['key'] == active:
                active_label = item['label']
                break
    context.update({
        'hq_active': active,
        'hq_active_label': active_label,
        'hq_member': member_for(request.user),
        'hq_nav_groups': nav_groups,
        'roadmap_url': ROADMAP_URL,
    })
    return render(request, template, context)


@hq_access(SectionAccess.Section.DASHBOARD)
def dashboard(request):
    projects = visible_projects(request.user).exclude(status=Project.Status.ARCHIVED)
    member = member_for(request.user)
    task_query = Task.objects.filter(project__in=projects).exclude(status=Task.Status.DONE)
    if member and not request.user.is_superuser:
        task_query = task_query.filter(Q(assignee=member) | Q(project__owner=member)).distinct()

    now = timezone.now()
    content_qs = ContentProduction.objects.filter(project__in=projects).select_related('project', 'public_content')
    attention_projects = projects.filter(
        Q(status=Project.Status.BLOCKED) | Q(priority__in=[Project.Priority.URGENT, Project.Priority.HIGH])
    ).select_related('owner').order_by('due_date', 'name')[:6]

    context = {
        'project_count': projects.count(),
        'active_project_count': projects.filter(status=Project.Status.ACTIVE).count(),
        'blocked_project_count': projects.filter(status=Project.Status.BLOCKED).count(),
        'open_task_count': Task.objects.filter(project__in=projects).exclude(status=Task.Status.DONE).count(),
        'overdue_task_count': Task.objects.filter(project__in=projects, due_at__lt=now).exclude(status=Task.Status.DONE).count(),
        'review_content_count': content_qs.filter(stage=ContentProduction.Stage.SCIENTIFIC_REVIEW).count(),
        'my_tasks': task_query.select_related('project', 'assignee').order_by('due_at', '-priority')[:8],
        'recent_content': content_qs.order_by('-updated_at')[:5],
        'attention_projects': attention_projects,
        'strategy_docs': StrategyDocument.objects.filter(status=StrategyDocument.Status.ACTIVE).exclude(slug='gravitas-strategy-roadmap').order_by('-updated_at')[:4] if has_access(request.user, SectionAccess.Section.STRATEGY) else [],
    }
    return hq_render(request, 'hq/dashboard.html', context)


@hq_access(SectionAccess.Section.DASHBOARD)
def search(request):
    query = request.GET.get('q', '').strip()
    projects = visible_projects(request.user)
    context = {
        'query': query,
        'project_results': [],
        'task_results': [],
        'content_results': [],
        'source_results': [],
        'asset_results': [],
    }
    if query:
        context['project_results'] = projects.filter(
            Q(name__icontains=query) | Q(description__icontains=query)
        ).select_related('owner')[:10]
        context['task_results'] = Task.objects.filter(project__in=projects).filter(
            Q(title__icontains=query) | Q(description__icontains=query)
        ).select_related('project', 'assignee')[:10]
        if has_access(request.user, SectionAccess.Section.CONTENT):
            context['content_results'] = ContentProduction.objects.filter(project__in=projects).filter(
                Q(working_title__icontains=query) | Q(central_question__icontains=query) | Q(brief__icontains=query)
            ).select_related('project')[:10]
        if has_access(request.user, SectionAccess.Section.RESEARCH):
            context['source_results'] = EvidenceSource.objects.filter(
                Q(title__icontains=query) | Q(authors__icontains=query) | Q(publisher__icontains=query) | Q(notes__icontains=query)
            )[:10]
        if has_access(request.user, SectionAccess.Section.ASSETS):
            context['asset_results'] = AssetReference.objects.filter(
                Q(project__in=projects) | Q(project__isnull=True)
            ).filter(Q(title__icontains=query) | Q(notes__icontains=query)).select_related('project')[:10]
    return hq_render(request, 'hq/search.html', context, active='search')


@hq_access(SectionAccess.Section.STRATEGY)
def strategy(request):
    docs = StrategyDocument.objects.select_related('owner').exclude(slug='gravitas-strategy-roadmap')
    objectives = Objective.objects.select_related('owner').all()
    return hq_render(request, 'hq/strategy.html', {'documents': docs, 'objectives': objectives}, active='strategy')


@hq_access(SectionAccess.Section.STRATEGY, SectionAccess.Level.EDIT)
def strategy_new(request):
    form = StrategyDocumentForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        obj = form.save(commit=False)
        obj.updated_by = member_for(request.user)
        obj.save()
        messages.success(request, 'Strategy document created.')
        return redirect('hq:strategy_edit', pk=obj.pk)
    return hq_render(request, 'hq/form.html', {
        'form': form,
        'title': 'New working document',
        'eyebrow': 'Strategy',
        'description': 'Use HQ documents for working notes and decisions. The master Gravitas roadmap stays in the external strategy document.',
    }, active='strategy')


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
    return hq_render(request, 'hq/form.html', {
        'form': form,
        'title': obj.title,
        'eyebrow': f'{obj.get_kind_display()} · v{obj.version}',
        'description': 'Working strategy note. Use the master roadmap for the canonical strategic direction.',
        'object': obj,
    }, active='strategy')


@hq_access(SectionAccess.Section.PROJECTS)
def projects(request):
    qs = visible_projects(request.user).select_related('owner', 'objective').annotate(
        open_tasks=Count('tasks', filter=~Q(tasks__status=Task.Status.DONE))
    )
    query = request.GET.get('q', '').strip()
    status = request.GET.get('status', '').strip()
    kind = request.GET.get('kind', '').strip()
    if query:
        qs = qs.filter(Q(name__icontains=query) | Q(description__icontains=query))
    if status in {value for value, _ in Project.Status.choices}:
        qs = qs.filter(status=status)
    if kind in {value for value, _ in Project.Kind.choices}:
        qs = qs.filter(kind=kind)
    context = {
        'projects': qs,
        'query': query,
        'selected_status': status,
        'selected_kind': kind,
        'project_statuses': Project.Status.choices,
        'project_kinds': Project.Kind.choices,
        'active_count': visible_projects(request.user).filter(status=Project.Status.ACTIVE).count(),
        'blocked_count': visible_projects(request.user).filter(status=Project.Status.BLOCKED).count(),
    }
    return hq_render(request, 'hq/projects.html', context, active='projects')


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
    return hq_render(request, 'hq/form.html', {
        'form': form,
        'title': 'Create project',
        'eyebrow': 'Projects',
        'description': 'A project is the execution container that connects an objective, owner, tasks, content and assets.',
    }, active='projects')


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
    total_tasks = tasks.count()
    done_tasks = tasks.filter(status=Task.Status.DONE).count()
    board = [(value, label, tasks.filter(status=value)) for value, label in Task.Status.choices]
    production = ContentProduction.objects.filter(project=project).first()
    return hq_render(request, 'hq/project_detail.html', {
        'project': project,
        'board': board,
        'task_form': task_form,
        'can_manage': can_manage,
        'production': production,
        'total_tasks': total_tasks,
        'done_tasks': done_tasks,
        'open_tasks': total_tasks - done_tasks,
        'blocked_tasks': tasks.filter(status=Task.Status.BLOCKED).count(),
        'progress_percent': round((done_tasks / total_tasks) * 100) if total_tasks else 0,
        'asset_count': project.assets.count(),
        'milestone_count': project.milestones.count(),
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
    productions = ContentProduction.objects.filter(project__in=projects_qs).select_related('project', 'public_content')
    query = request.GET.get('q', '').strip()
    stage = request.GET.get('stage', '').strip()
    if query:
        productions = productions.filter(Q(working_title__icontains=query) | Q(central_question__icontains=query))
    if stage in {value for value, _ in ContentProduction.Stage.choices}:
        productions = productions.filter(stage=stage)
    productions = productions.order_by('planned_publish_at', '-updated_at')
    all_productions = ContentProduction.objects.filter(project__in=projects_qs)
    stage_summary = [
        {'value': value, 'label': label, 'count': all_productions.filter(stage=value).count()}
        for value, label in ContentProduction.Stage.choices
        if all_productions.filter(stage=value).exists()
    ]
    return hq_render(request, 'hq/content.html', {
        'productions': productions,
        'query': query,
        'selected_stage': stage,
        'stages': ContentProduction.Stage.choices,
        'stage_summary': stage_summary,
    }, active='content')


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
    return hq_render(request, 'hq/content_edit.html', {
        'form': form,
        'production': production,
        'can_edit': can_edit,
        'claim_count': production.claims.count(),
        'asset_count': production.assets.count(),
    }, active='content')


@hq_access(SectionAccess.Section.RESEARCH)
def research(request):
    sources = EvidenceSource.objects.select_related('added_by').all()
    query = request.GET.get('q', '').strip()
    kind = request.GET.get('kind', '').strip()
    if query:
        sources = sources.filter(Q(title__icontains=query) | Q(authors__icontains=query) | Q(publisher__icontains=query) | Q(notes__icontains=query))
    if kind in {value for value, _ in EvidenceSource.Kind.choices}:
        sources = sources.filter(kind=kind)
    sources = sources[:100]
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
    return hq_render(request, 'hq/research.html', {
        'sources': sources,
        'form': form,
        'query': query,
        'selected_kind': kind,
        'source_kinds': EvidenceSource.Kind.choices,
    }, active='research')


@hq_access(SectionAccess.Section.ASSETS)
def assets(request):
    projects_qs = visible_projects(request.user)
    assets_qs = AssetReference.objects.filter(Q(project__in=projects_qs) | Q(project__isnull=True)).select_related('project', 'production', 'created_by').distinct()
    query = request.GET.get('q', '').strip()
    provider = request.GET.get('provider', '').strip()
    status = request.GET.get('status', '').strip()
    if query:
        assets_qs = assets_qs.filter(Q(title__icontains=query) | Q(notes__icontains=query) | Q(version__icontains=query))
    if provider in {value for value, _ in AssetReference.Provider.choices}:
        assets_qs = assets_qs.filter(provider=provider)
    if status in {value for value, _ in AssetReference.Status.choices}:
        assets_qs = assets_qs.filter(status=status)
    assets_qs = assets_qs[:120]
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
    return hq_render(request, 'hq/assets.html', {
        'assets': assets_qs,
        'form': form,
        'query': query,
        'selected_provider': provider,
        'selected_status': status,
        'providers': AssetReference.Provider.choices,
        'asset_statuses': AssetReference.Status.choices,
    }, active='assets')


@hq_access(SectionAccess.Section.TEAM)
def team(request):
    members = TeamMember.objects.select_related('user').prefetch_related('section_access').all()
    return hq_render(request, 'hq/team.html', {
        'members': members,
        'sections': SectionAccess.Section.choices,
        'levels': SectionAccess.Level.choices,
    }, active='team')


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
