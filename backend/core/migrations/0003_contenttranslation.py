from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_comment_labprogress'),
    ]

    operations = [
        migrations.CreateModel(
            name='ContentTranslation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('locale', models.CharField(choices=[('de', 'Deutsch'), ('fa', 'فارسی')], max_length=8)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('published', 'Published')], default='draft', max_length=16)),
                ('title', models.CharField(max_length=220)),
                ('summary', models.TextField(blank=True)),
                ('body', models.TextField(blank=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('content', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='translations', to='core.contentitem')),
            ],
            options={
                'ordering': ['content_id', 'locale'],
            },
        ),
        migrations.AddConstraint(
            model_name='contenttranslation',
            constraint=models.UniqueConstraint(fields=('content', 'locale'), name='unique_content_translation_locale'),
        ),
    ]
