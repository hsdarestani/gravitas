from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0030_course_payments'),
    ]

    operations = [
        migrations.CreateModel(
            name='ResearchIntelligenceRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('running', 'Running'), ('success', 'Success'), ('partial', 'Partial'), ('failed', 'Failed')], db_index=True, default='running', max_length=16)),
                ('counts', models.JSONField(blank=True, default=dict)),
                ('errors', models.JSONField(blank=True, default=list)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={'ordering': ['-started_at']},
        ),
        migrations.CreateModel(
            name='ResearchIntelligenceItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=64, unique=True)),
                ('kind', models.CharField(db_index=True, max_length=32)),
                ('source', models.CharField(db_index=True, max_length=120)),
                ('external_id', models.CharField(blank=True, max_length=320)),
                ('title', models.CharField(max_length=500)),
                ('summary', models.TextField(blank=True)),
                ('url', models.URLField(blank=True, max_length=1200)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('first_seen_at', models.DateTimeField(auto_now_add=True)),
                ('last_seen_at', models.DateTimeField(auto_now=True)),
                ('active', models.BooleanField(db_index=True, default=True)),
            ],
            options={'ordering': ['-last_seen_at']},
        ),
        migrations.CreateModel(
            name='ResearchIntelligenceEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(choices=[('new', 'New'), ('updated', 'Updated')], db_index=True, max_length=16)),
                ('changed_fields', models.JSONField(blank=True, default=list)),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('observed_at', models.DateTimeField(auto_now_add=True)),
                ('item', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history_events', to='core.researchintelligenceitem')),
                ('run', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='core.researchintelligencerun')),
            ],
            options={'ordering': ['-observed_at']},
        ),
        migrations.AddIndex(
            model_name='researchintelligencerun',
            index=models.Index(fields=['status', '-started_at'], name='ri_run_status_time'),
        ),
        migrations.AddIndex(
            model_name='researchintelligenceitem',
            index=models.Index(fields=['kind', '-last_seen_at'], name='ri_item_kind_seen'),
        ),
        migrations.AddIndex(
            model_name='researchintelligenceitem',
            index=models.Index(fields=['source', '-last_seen_at'], name='ri_item_src_seen'),
        ),
        migrations.AddIndex(
            model_name='researchintelligenceevent',
            index=models.Index(fields=['event_type', '-observed_at'], name='ri_event_type_time'),
        ),
        migrations.AddIndex(
            model_name='researchintelligenceevent',
            index=models.Index(fields=['item', '-observed_at'], name='ri_event_item_time'),
        ),
    ]
