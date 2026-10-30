from django.contrib import admin
from django import forms
from django.core.exceptions import ValidationError
from django.utils import timezone
from datetime import timedelta

from .operating_models import (
    Initiative,
    KeyResult,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingProcess,
    OperatingRisk,
    OperatingTask,
    OperatingWorkPackage,
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
    list_display = ('title', 'process', 'stage', 'key_result', 'owner', 'priority', 'health', 'status', 'due_date')
    list_filter = ('process__key', 'priority', 'health', 'status')
    search_fields = ('title', 'description', 'stage', 'key_result__title', 'owner__email')


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


@admin.register(OperatingWorkPackage)
class OperatingWorkPackageAdmin(admin.ModelAdmin):
    list_display = ('title', 'milestone', 'project', 'owner', 'due_date', 'status')
    list_filter = ('status', 'milestone__initiative__process__key')
    search_fields = ('title', 'description', 'milestone__title', 'owner__email')


class TaskDateAdminForm(forms.ModelForm):
    class Meta:
        model = OperatingTask
        fields = '__all__'

    def clean(self):
        values = super().clean()
        created, started, completed = (values.get(key) for key in ('created_at', 'started_at', 'completed_at'))
        if ((created and started and started < created) or
                (completed and (started or created) and completed < (started or created))):
            raise ValidationError('Creation, activity and completion dates must be in chronological order.')
        for key in ('created_at', 'started_at', 'completed_at'):
            if key in self.changed_data and values.get(key) and values[key] > timezone.now() + timedelta(minutes=5):
                self.add_error(key, 'Actual dates cannot be in the future.')
        return values


@admin.register(OperatingTask)
class OperatingTaskAdmin(admin.ModelAdmin):
    form = TaskDateAdminForm
    list_display = ('title', 'initiative', 'work_package', 'owner', 'priority', 'status', 'created_at', 'started_at', 'completed_at', 'due_date')
    readonly_fields = ('date_provenance', 'updated_at')

    def save_model(self, request, obj, form, change):
        from .task_dates import apply_date_patch
        payload = {key: getattr(obj, key).isoformat() if getattr(obj, key) else None
                   for key in ('created_at', 'started_at', 'completed_at') if key in form.changed_data}
        apply_date_patch(obj, payload, request.user)
        super().save_model(request, obj, form, change)
    list_filter = ('priority', 'status', 'initiative__process__key')
    search_fields = ('title', 'description', 'definition_of_done', 'owner__email', 'initiative__title')


@admin.register(OperatingRisk)
class OperatingRiskAdmin(admin.ModelAdmin):
    list_display = ('title', 'initiative', 'project', 'owner', 'health', 'status', 'due_date')
    list_filter = ('health', 'status')
    search_fields = ('title', 'description', 'mitigation', 'owner__email', 'initiative__title')


@admin.register(OperatingMeeting)
class OperatingMeetingAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'scheduled_for', 'owner', 'status')
    list_filter = ('kind', 'status')
    search_fields = ('title', 'decisions', 'notes', 'owner__email')
