from django.contrib import admin

from .operating_models import (
    Initiative,
    KeyResult,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingProcess,
    OperatingTask,
    StrategicObjective,
)


@admin.register(OperatingProcess)
class OperatingProcessAdmin(admin.ModelAdmin):
    list_display = ('name', 'key', 'workspace', 'owner', 'active', 'updated_at')
    list_filter = ('key', 'active')
    search_fields = ('name', 'workspace__name', 'owner__email')


@admin.register(StrategicObjective)
class StrategicObjectiveAdmin(admin.ModelAdmin):
    list_display = ('title', 'quarter', 'workspace', 'owner', 'health', 'status', 'due_date')
    list_filter = ('health', 'status', 'quarter')
    search_fields = ('title', 'description', 'workspace__name', 'owner__email')


@admin.register(KeyResult)
class KeyResultAdmin(admin.ModelAdmin):
    list_display = ('title', 'objective', 'owner', 'health', 'status', 'current_value', 'target_value', 'due_date')
    list_filter = ('health', 'status')
    search_fields = ('title', 'metric_name', 'objective__title', 'owner__email')


@admin.register(Initiative)
class InitiativeAdmin(admin.ModelAdmin):
    list_display = ('title', 'process', 'key_result', 'owner', 'priority', 'health', 'status', 'due_date')
    list_filter = ('process__key', 'priority', 'health', 'status')
    search_fields = ('title', 'description', 'key_result__title', 'owner__email')


@admin.register(OperatingCycle)
class OperatingCycleAdmin(admin.ModelAdmin):
    list_display = ('name', 'process', 'cadence', 'owner', 'start_date', 'end_date', 'status')
    list_filter = ('cadence', 'status', 'process__key')
    search_fields = ('name', 'owner__email')


@admin.register(OperatingMilestone)
class OperatingMilestoneAdmin(admin.ModelAdmin):
    list_display = ('title', 'initiative', 'owner', 'due_date', 'health', 'status')
    list_filter = ('health', 'status')
    search_fields = ('title', 'initiative__title', 'owner__email')


@admin.register(OperatingTask)
class OperatingTaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'initiative', 'owner', 'priority', 'status', 'due_date', 'updated_at')
    list_filter = ('priority', 'status', 'initiative__process__key')
    search_fields = ('title', 'description', 'definition_of_done', 'owner__email', 'initiative__title')


@admin.register(OperatingMeeting)
class OperatingMeetingAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'scheduled_for', 'owner', 'status')
    list_filter = ('kind', 'status')
    search_fields = ('title', 'decisions', 'notes', 'owner__email')
