from django import forms

from .models import (
    AssetReference,
    ContentProduction,
    EvidenceSource,
    Project,
    StrategyDocument,
    Task,
)


class StyledModelForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            css = 'hq-input'
            if isinstance(field.widget, forms.Textarea):
                css += ' hq-textarea'
            field.widget.attrs.setdefault('class', css)


class StrategyDocumentForm(StyledModelForm):
    class Meta:
        model = StrategyDocument
        fields = ['title', 'slug', 'kind', 'status', 'summary', 'body', 'owner']
        widgets = {'body': forms.Textarea(attrs={'rows': 18}), 'summary': forms.Textarea(attrs={'rows': 4})}


class ProjectForm(StyledModelForm):
    class Meta:
        model = Project
        fields = ['name', 'slug', 'kind', 'status', 'priority', 'description', 'objective', 'owner', 'start_date', 'due_date']
        widgets = {
            'description': forms.Textarea(attrs={'rows': 5}),
            'start_date': forms.DateInput(attrs={'type': 'date'}),
            'due_date': forms.DateInput(attrs={'type': 'date'}),
        }


class TaskForm(StyledModelForm):
    class Meta:
        model = Task
        fields = ['title', 'description', 'status', 'priority', 'assignee', 'milestone', 'due_at', 'estimate_minutes']
        widgets = {
            'description': forms.Textarea(attrs={'rows': 4}),
            'due_at': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
        }


class ContentProductionForm(StyledModelForm):
    class Meta:
        model = ContentProduction
        fields = [
            'working_title', 'central_question', 'stage', 'topic_score', 'brief', 'script',
            'scientific_notes', 'distribution_notes', 'postmortem', 'planned_publish_at',
            'youtube_url', 'public_content',
        ]
        widgets = {
            'central_question': forms.Textarea(attrs={'rows': 3}),
            'brief': forms.Textarea(attrs={'rows': 8}),
            'script': forms.Textarea(attrs={'rows': 18}),
            'scientific_notes': forms.Textarea(attrs={'rows': 8}),
            'distribution_notes': forms.Textarea(attrs={'rows': 6}),
            'postmortem': forms.Textarea(attrs={'rows': 6}),
            'planned_publish_at': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
        }


class EvidenceSourceForm(StyledModelForm):
    class Meta:
        model = EvidenceSource
        fields = ['title', 'kind', 'url', 'doi', 'authors', 'publisher', 'published_date', 'notes']
        widgets = {'published_date': forms.DateInput(attrs={'type': 'date'}), 'notes': forms.Textarea(attrs={'rows': 5})}


class AssetReferenceForm(StyledModelForm):
    class Meta:
        model = AssetReference
        fields = ['title', 'asset_type', 'provider', 'url', 'external_id', 'project', 'production', 'version', 'status', 'size_bytes', 'notes']
        widgets = {'notes': forms.Textarea(attrs={'rows': 5})}
        help_texts = {
            'url': 'External location only. Large files are not uploaded to the Gravitas server.',
            'size_bytes': 'Optional metadata only; the binary remains on the external provider.',
        }
