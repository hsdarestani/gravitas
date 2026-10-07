from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('core', '0054_task_mentions_and_in_app_notifications')]

    operations = [
        migrations.CreateModel(
            name='CourseRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('payload', models.JSONField(default=dict)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('scheduled', 'Scheduled'), ('published', 'Published'), ('cancelled', 'Cancelled')], db_index=True, default='draft', max_length=20)),
                ('scheduled_for', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_course_revisions_authored', to=settings.AUTH_USER_MODEL)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='revisions', to='core.course')),
                ('published_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_course_revisions_published', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at', '-id']},
        ),
        migrations.AddIndex(model_name='courserevision', index=models.Index(fields=['course', 'status', '-updated_at'], name='grav_course_rev_state')),
        migrations.AddIndex(model_name='courserevision', index=models.Index(fields=['status', 'scheduled_for'], name='grav_course_rev_schedule')),
    ]
