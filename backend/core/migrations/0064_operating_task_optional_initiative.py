# A task is the same object in Core and Research, with optional KR and project.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0063_rename_brand_choice_labels'),
    ]

    operations = [
        migrations.AlterField(
            model_name='operatingtask',
            name='initiative',
            field=models.ForeignKey(
                to='core.initiative',
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tasks',
                null=True,
                blank=True,
            ),
        ),
    ]
