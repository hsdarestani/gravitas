from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0044_research_intelligence_saved_items'),
    ]

    operations = [
        migrations.AddField(
            model_name='readersaveditem',
            name='seen_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
