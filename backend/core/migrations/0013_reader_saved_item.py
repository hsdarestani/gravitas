from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """What a reader kept before they had an account.

    One table for both relations — saved and following — because the guest
    store that feeds it makes no distinction either, and adopting a guest pile
    has to be one write rather than a fan-out across models.
    """

    dependencies = [
        ('core', '0012_researcher_avatar'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ReaderSavedItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('relation', models.CharField(choices=[('saved', 'Saved'), ('following', 'Following')], db_index=True, default='saved', max_length=16)),
                ('kind', models.CharField(choices=[('article', 'Article'), ('dossier', 'Dossier'), ('topic', 'Topic'), ('path', 'Learning path'), ('lab', 'Lab / Interactive'), ('page', 'Page')], default='article', max_length=24)),
                ('item_key', models.SlugField(db_index=True, max_length=190)),
                ('url', models.CharField(blank=True, max_length=300)),
                ('title', models.CharField(max_length=240)),
                ('summary', models.TextField(blank=True)),
                ('meta', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_saved_items', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='readersaveditem',
            index=models.Index(fields=['user', 'relation', '-created_at'], name='grav_saved_reader_recent'),
        ),
        migrations.AddConstraint(
            model_name='readersaveditem',
            constraint=models.UniqueConstraint(fields=('user', 'relation', 'item_key'), name='unique_reader_saved_item'),
        ),
    ]
