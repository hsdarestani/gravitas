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
        for name, field in self.fields.items():
            css = 'hq-input'
            if isinstance(field.widget, forms.Textarea):
                css += ' hq-textarea'
            field.widget.attrs.setdefault('class', css)
            field.widget.attrs.setdefault('aria-label', field.label)
            if field.required:
                field.widget.attrs.setdefault('aria-required', 'true')


class StrategyDocumentForm(StyledModelForm):
    class Meta:
        model = StrategyDocument
        fields = ['title', 'slug', 'kind', 'status', 'summary', 'body', 'owner']
        widgets = {
            'title': forms.TextInput(attrs={'placeholder': 'Example: Editorial principles'}),
            'slug': forms.TextInput(attrs={'placeholder': 'editorial-principles'}),
            'body': forms.Textarea(attrs={'rows': 18, 'placeholder': 'Use this for working notes, decisions, or supporting strategy documentation.'}),
            'summary': forms.Textarea(attrs={'rows': 4, 'placeholder': 'One short paragraph explaining what this document is for.'}),
        }
        help_texts = {
            'slug': 'Short URL-safe identifier. Use lowercase words separated by hyphens.',
            'status': 'Use Active only for documents the team should currently rely on.',
        }


class ProjectForm(StyledModelForm):
    class Meta:
        model = Project
        fields = ['name', 'slug', 'kind', 'status', 'priority', 'description', 'objective', 'owner', 'start_date', 'due_date']
        widgets = {
            'name': forms.TextInput(attrs={'placeholder': 'Example: Episode 01 — AI hypotheses'}),
            'slug': forms.TextInput(attrs={'placeholder': 'episode-01-ai-hypotheses'}),
            'description': forms.Textarea(attrs={'rows': 5, 'placeholder': 'What are we trying to deliver, for whom, and what does done look like?'}),
            'start_date': forms.DateInput(attrs={'type': 'date'}),
            'due_date': forms.DateInput(attrs={'type': 'date'}),
        }
        help_texts = {
            'objective': 'Link the project to the strategic outcome it supports.',
            'owner': 'The person accountable for moving the project forward.',
        }


class TaskForm(StyledModelForm):
    class Meta:
        model = Task
        fields = ['title', 'description', 'status', 'priority', 'assignee', 'milestone', 'due_at', 'estimate_minutes']
        widgets = {
            'title': forms.TextInput(attrs={'placeholder': 'Start with a verb, e.g. Review evidence map'}),
            'description': forms.Textarea(attrs={'rows': 4, 'placeholder': 'Add enough context so another teammate can complete this without asking what it means.'}),
            'due_at': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
            'estimate_minutes': forms.NumberInput(attrs={'min': 0, 'step': 15, 'placeholder': '60'}),
        }
        help_texts = {
            'estimate_minutes': 'Optional rough effort estimate in minutes.',
            'milestone': 'Use milestones for meaningful checkpoints, not every small task.',
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
            'working_title': forms.TextInput(attrs={'placeholder': 'Working title, not necessarily the final YouTube title'}),
            'central_question': forms.Textarea(attrs={'rows': 3, 'placeholder': 'What exact question should this piece help the audience think about?'}),
            'brief': forms.Textarea(attrs={'rows': 8, 'placeholder': 'Audience, angle, promise, scope, exclusions, structure and success criteria.'}),
            'script': forms.Textarea(attrs={'rows': 18, 'placeholder': 'Draft the narrative here or link the external script as an asset if the team prefers another editor.'}),
            'scientific_notes': forms.Textarea(attrs={'rows': 8, 'placeholder': 'Review notes, disputed claims, caveats and required revisions.'}),
            'distribution_notes': forms.Textarea(attrs={'rows': 6, 'placeholder': 'YouTube, Shorts, newsletter, community and companion-page distribution plan.'}),
            'postmortem': forms.Textarea(attrs={'rows': 6, 'placeholder': 'What worked, what failed, what to repeat, and what to change next time.'}),
            'planned_publish_at': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
            'youtube_url': forms.URLInput(attrs={'placeholder': 'https://youtube.com/...'}),
        }
        help_texts = {
            'topic_score': 'Optional internal score used before committing production resources.',
            'public_content': 'Link the internal production workflow to the published CMS item when it exists.',
            'stage': 'Move this forward only when the current stage is genuinely complete.',
        }


class EvidenceSourceForm(StyledModelForm):
    class Meta:
        model = EvidenceSource
        fields = ['title', 'kind', 'url', 'doi', 'authors', 'publisher', 'published_date', 'notes']
        widgets = {
            'title': forms.TextInput(attrs={'placeholder': 'Paper, dataset, book, report or interview title'}),
            'url': forms.URLInput(attrs={'placeholder': 'https://...'}),
            'doi': forms.TextInput(attrs={'placeholder': '10.xxxx/xxxxx'}),
            'authors': forms.TextInput(attrs={'placeholder': 'Author names'}),
            'publisher': forms.TextInput(attrs={'placeholder': 'Journal, university, publisher or institution'}),
            'published_date': forms.DateInput(attrs={'type': 'date'}),
            'notes': forms.Textarea(attrs={'rows': 5, 'placeholder': 'Why is this source useful? Which claim or part of the project does it inform?'}),
        }
        help_texts = {
            'doi': 'Optional. Keep the DOI when available so the source can be resolved reliably later.',
            'notes': 'Capture usefulness and caveats, not a full paper summary.',
        }


class AssetReferenceForm(StyledModelForm):
    class Meta:
        model = AssetReference
        fields = ['title', 'asset_type', 'provider', 'url', 'external_id', 'project', 'production', 'version', 'status', 'size_bytes', 'notes']
        widgets = {
            'title': forms.TextInput(attrs={'placeholder': 'Example: Episode 01 rough cut'}),
            'url': forms.URLInput(attrs={'placeholder': 'https://drive.google.com/... or https://frame.io/...'}),
            'external_id': forms.TextInput(attrs={'placeholder': 'Optional provider/file ID'}),
            'version': forms.TextInput(attrs={'placeholder': 'v1, v2, final-3, etc.'}),
            'notes': forms.Textarea(attrs={'rows': 5, 'placeholder': 'What is this asset, who needs it, and what should reviewers know?'}),
        }
        help_texts = {
            'url': 'External location only. Large files are not uploaded to the Gravitas server.',
            'size_bytes': 'Optional metadata only; the binary remains on the external provider.',
            'status': 'Use Review when feedback is needed and Final only for the approved deliverable.',
        }
