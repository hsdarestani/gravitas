# Generated manually for the Research document annotation contract.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_kms_state'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentAnnotation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=10000)),
                ('anchor', models.JSONField(blank=True, default=dict)),
                ('resolved', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_document_annotations', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='replies', to='core.documentannotation')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='document_annotations', to='core.researchproject')),
                ('resource', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='annotations', to='core.knowledgeresource')),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
        migrations.AddIndex(
            model_name='documentannotation',
            index=models.Index(fields=['resource', 'resolved', 'created_at'], name='grav_annotation_resource_state'),
        ),
        migrations.AddIndex(
            model_name='documentannotation',
            index=models.Index(fields=['project', 'resolved'], name='grav_annotation_project_state'),
        ),
    ]
