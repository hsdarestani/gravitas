from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0027_lms_advanced_learning'),
    ]

    operations = [
        migrations.AddField(
            model_name='learningrepository',
            name='review_status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending review'),
                    ('needs_changes', 'Needs changes'),
                    ('approved', 'Approved'),
                ],
                db_index=True,
                default='pending',
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name='learningrepository',
            name='review_note',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='learningrepository',
            name='reviewed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='learningrepository',
            name='reviewed_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='gravitas_learning_repository_reviews',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
