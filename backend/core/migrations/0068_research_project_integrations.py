from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0067_historical_source_tasks_without_fake_deadlines"),
    ]

    operations = [
        migrations.AddField(
            model_name="researchprojectprofile",
            name="selected_integrations",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="researchprojectprofile",
            name="requested_plugins",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
