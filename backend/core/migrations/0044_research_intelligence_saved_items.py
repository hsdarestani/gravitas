from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0043_task_notifications'),
    ]

    operations = [
        migrations.CreateModel(
            name='ResearchIntelligenceSavedItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('item_key', models.CharField(max_length=400)),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_research_intelligence_saves', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
                'indexes': [models.Index(fields=['user', '-updated_at'], name='ri_saved_user_recent')],
            },
        ),
        migrations.AddConstraint(
            model_name='researchintelligencesaveditem',
            constraint=models.UniqueConstraint(fields=('user', 'item_key'), name='unique_research_intelligence_save'),
        ),
    ]
