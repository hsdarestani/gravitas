from django.contrib import admin

from .models import Comment, ContentItem, NewsletterSubscriber


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'status', 'published_at', 'updated_at')
    list_filter = ('kind', 'status')
    search_fields = ('title', 'slug', 'summary', 'body')
    prepopulated_fields = {'slug': ('title',)}
    ordering = ('-published_at', '-created_at')
    readonly_fields = ('created_at', 'updated_at')


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
