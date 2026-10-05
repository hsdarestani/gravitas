from django.db import migrations, models
import django.db.models.deletion
import pgvector.django


def enable_vector(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('CREATE EXTENSION IF NOT EXISTS vector')


def create_vector_index(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(
            'CREATE INDEX IF NOT EXISTS pulsar_semantic_embedding_hnsw '
            'ON core_pulsarsemanticchunk USING hnsw (embedding vector_cosine_ops) '
            'WHERE embedding IS NOT NULL'
        )


def drop_vector_index(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('DROP INDEX IF EXISTS pulsar_semantic_embedding_hnsw')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0057_pulsar_memory_threads_runs'),
    ]

    operations = [
        migrations.RunPython(enable_vector, migrations.RunPython.noop),
        migrations.CreateModel(
            name='PulsarSemanticChunk',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_type', models.CharField(db_index=True, max_length=32)),
                ('source_id', models.CharField(db_index=True, max_length=160)),
                ('chunk_index', models.PositiveSmallIntegerField(default=0)),
                ('workspace_id_ref', models.BigIntegerField(blank=True, db_index=True, null=True)),
                ('project_id_ref', models.BigIntegerField(blank=True, db_index=True, null=True)),
                ('course_id_ref', models.BigIntegerField(blank=True, db_index=True, null=True)),
                ('content', models.TextField()),
                ('content_hash', models.CharField(max_length=64)),
                ('embedding', pgvector.django.VectorField(blank=True, dimensions=1024, null=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('indexed_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['source_type', 'source_id', 'chunk_index']},
        ),
        migrations.AddConstraint(
            model_name='pulsarsemanticchunk',
            constraint=models.UniqueConstraint(fields=('source_type', 'source_id', 'chunk_index'), name='unique_pulsar_semantic_chunk'),
        ),
        migrations.AddIndex(
            model_name='pulsarsemanticchunk',
            index=models.Index(fields=['source_type', 'source_id'], name='pulsar_semantic_source'),
        ),
        migrations.AddIndex(
            model_name='pulsarsemanticchunk',
            index=models.Index(fields=['project_id_ref', 'source_type'], name='pulsar_semantic_project'),
        ),
        migrations.RunPython(create_vector_index, drop_vector_index),
    ]
