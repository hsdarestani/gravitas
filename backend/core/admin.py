from django.contrib import admin

from .models import (
    Collection,
    KnowledgeActivity,
    KnowledgeResource,
    NextcloudIdentity,
    Organization,
    OrganizationMembership,
    ProjectMembership,
    ResearchProject,
    StoragePlan,
    Tag,
    Workspace,
    WorkspaceMembership,
)


admin.site.register(Organization)
admin.site.register(OrganizationMembership)
admin.site.register(Workspace)
admin.site.register(WorkspaceMembership)
admin.site.register(StoragePlan)
admin.site.register(NextcloudIdentity)
admin.site.register(ResearchProject)
admin.site.register(ProjectMembership)
admin.site.register(Collection)
admin.site.register(Tag)
admin.site.register(KnowledgeResource)
admin.site.register(KnowledgeActivity)
from django.utils import timezone

from .models import (
    Comment,
    ContentItem,
    ContentTranslation,
    LabProgress,
    NewsletterSubscriber,
)


class ContentTranslationInline(admin.StackedInline):
    model = ContentTranslation
    extra = 0
    fields = ('locale', 'status', 'title', 'summary', 'body', 'published_at')
    show_change_link = True


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'status', 'published_at', 'updated_at')
    list_filter = ('kind', 'status')
    search_fields = ('title', 'slug', 'summary', 'body', 'translations__title')
    prepopulated_fields = {'slug': ('title',)}
    ordering = ('-published_at', '-created_at')
    readonly_fields = ('created_at', 'updated_at')
    actions = ('publish_now', 'move_to_draft')
    inlines = (ContentTranslationInline,)

    @admin.action(description='Publish selected content now')
    def publish_now(self, request, queryset):
        queryset.update(status=ContentItem.Status.PUBLISHED, published_at=timezone.now())

    @admin.action(description='Move selected content to draft')
    def move_to_draft(self, request, queryset):
        queryset.update(status=ContentItem.Status.DRAFT)

    def save_model(self, request, obj, form, change):
        if obj.status == ContentItem.Status.PUBLISHED and obj.published_at is None:
            obj.published_at = timezone.now()
        super().save_model(request, obj, form, change)


@admin.register(ContentTranslation)
class ContentTranslationAdmin(admin.ModelAdmin):
    list_display = ('title', 'content', 'locale', 'status', 'published_at', 'updated_at')
    list_filter = ('locale', 'status')
    search_fields = ('title', 'summary', 'body', 'content__title', 'content__slug')
    autocomplete_fields = ('content',)
    ordering = ('content__title', 'locale')
    readonly_fields = ('created_at', 'updated_at')

    def save_model(self, request, obj, form, change):
        if obj.status == ContentTranslation.Status.PUBLISHED and obj.published_at is None:
            obj.published_at = timezone.now()
        super().save_model(request, obj, form, change)


@admin.register(NewsletterSubscriber)
class NewsletterSubscriberAdmin(admin.ModelAdmin):
    list_display = ('email', 'is_active', 'source', 'created_at')
    list_filter = ('is_active', 'source')
    search_fields = ('email',)
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ('short_body', 'author', 'content_key', 'status', 'created_at')
    list_filter = ('status', 'content_key', 'created_at')
    search_fields = ('body', 'author__username', 'author__email', 'content_key')
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'updated_at')
    actions = ('publish_comments', 'hide_comments')

    @admin.display(description='Comment')
    def short_body(self, obj):
        return obj.body[:80]

    @admin.action(description='Publish selected comments')
    def publish_comments(self, request, queryset):
        queryset.update(status=Comment.Status.PUBLISHED)

    @admin.action(description='Hide selected comments')
    def hide_comments(self, request, queryset):
        queryset.update(status=Comment.Status.HIDDEN)


@admin.register(LabProgress)
class LabProgressAdmin(admin.ModelAdmin):
    list_display = ('user', 'lab_key', 'completed', 'score', 'updated_at')
    list_filter = ('completed', 'lab_key')
    search_fields = ('user__username', 'user__email', 'lab_key')
    ordering = ('-updated_at',)
    readonly_fields = ('created_at', 'updated_at')
