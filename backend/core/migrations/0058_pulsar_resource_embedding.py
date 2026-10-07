from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0057_pulsar_memory_thread_run'),
    ]

    operations = [
        migrations.CreateModel(
            name='PulsarResourceEmbedding',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(default='openai-compatible', max_length=80)),
                ('model_name', models.CharField(max_length=240)),
                ('dimensions', models.PositiveIntegerField(default=0)),
                ('vector', models.JSONField(default=list)),
                ('content_hash', models.CharField(db_index=True, max_length=64)),
                ('indexed_at', models.DateTimeField(auto_now=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('resource', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='pulsar_semantic_embedding', to='core.knowledgeresource')),
            ],
            options={'ordering': ['-indexed_at']},
        ),
        migrations.AddIndex(
            model_name='pulsarresourceembedding',
            index=models.Index(fields=['model_name', '-indexed_at'], name='pulsar_embed_model_time'),
        ),
    ]
