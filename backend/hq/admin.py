from django.contrib import admin

from .models import (
    AssetReference,
    Claim,
    ClaimEvidence,
    ContentProduction,
    EvidenceSource,
    Milestone,
    Objective,
    Project,
    ProjectMember,
    SectionAccess,
    StrategyDocument,
    Task,
    TeamMember,
)


class SectionAccessInline(admin.TabularInline):
    model = SectionAccess
    extra = 0


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ('user', 'title', 'role_label', 'status', 'updated_at')
    list_filter = ('status',)
    search_fields = ('user__email', 'user__username', 'user__first_name', 'user__last_name', 'title', 'role_label')
    inlines = (SectionAccessInline,)


@admin.register(StrategyDocument)
class StrategyDocumentAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'status', 'version', 'owner', 'updated_at')
    list_filter = ('kind', 'status')
    search_fields = ('title', 'summary', 'body')
    prepopulated_fields = {'slug': ('title',)}


@admin.register(Objective)
class ObjectiveAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'owner', 'target_date', 'metric_name', 'current_value', 'target_value')
    list_filter = ('status',)
    search_fields = ('title', 'description', 'metric_name')


class ProjectMemberInline(admin.TabularInline):
    model = ProjectMember
    extra = 0


class MilestoneInline(admin.TabularInline):
    model = Milestone
    extra = 0


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'kind', 'status', 'priority', 'owner', 'due_date')
    list_filter = ('kind', 'status', 'priority')
    search_fields = ('name', 'description')
    prepopulated_fields = {'slug': ('name',)}
    inlines = (ProjectMemberInline, MilestoneInline)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'project', 'status', 'priority', 'assignee', 'due_at')
    list_filter = ('status', 'priority', 'project')
    search_fields = ('title', 'description', 'project__name')


@admin.register(ContentProduction)
class ContentProductionAdmin(admin.ModelAdmin):
    list_display = ('working_title', 'project', 'stage', 'planned_publish_at', 'public_content')
    list_filter = ('stage',)
    search_fields = ('working_title', 'central_question', 'brief', 'script')


@admin.register(EvidenceSource)
class EvidenceSourceAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'publisher', 'published_date', 'added_by')
    list_filter = ('kind',)
    search_fields = ('title', 'authors', 'publisher', 'doi', 'url', 'notes')


class ClaimEvidenceInline(admin.TabularInline):
    model = ClaimEvidence
    extra = 0


@admin.register(Claim)
class ClaimAdmin(admin.ModelAdmin):
    list_display = ('short_statement', 'production', 'confidence', 'owner')
    list_filter = ('confidence',)
    search_fields = ('statement', 'notes')
    inlines = (ClaimEvidenceInline,)

    @admin.display(description='Claim')
    def short_statement(self, obj):
        return obj.statement[:100]


@admin.register(AssetReference)
class AssetReferenceAdmin(admin.ModelAdmin):
    list_display = ('title', 'asset_type', 'provider', 'status', 'project', 'version', 'updated_at')
    list_filter = ('asset_type', 'provider', 'status')
    search_fields = ('title', 'url', 'external_id', 'notes')
