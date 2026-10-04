from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0052_course_cover_image'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CourseRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('state', models.CharField(choices=[('draft', 'Draft'), ('scheduled', 'Scheduled')], db_index=True, default='draft', max_length=16)),
                ('scheduled_for', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='authoring_revision', to='core.course')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_course_revisions_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['scheduled_for', '-updated_at'],
            },
        ),
    ]
