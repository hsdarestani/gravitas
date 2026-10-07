from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0029_lms_asset_versioning'),
    ]

    operations = [
        migrations.CreateModel(
            name='CoursePayment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(db_index=True, default='external', max_length=40)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('currency', models.CharField(default='EUR', max_length=8)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('paid', 'Paid'), ('failed', 'Failed'), ('cancelled', 'Cancelled'), ('refunded', 'Refunded')], db_index=True, default='pending', max_length=20)),
                ('external_reference', models.CharField(blank=True, db_index=True, max_length=240)),
                ('checkout_url', models.URLField(blank=True, max_length=1800)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payments', to='core.course')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_course_payments', to=settings.AUTH_USER_MODEL)),
                ('verified_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='gravitas_course_payments_verified', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['course', 'status', '-created_at'], name='grav_lms_pay_course_state'),
                    models.Index(fields=['user', 'status', '-created_at'], name='grav_lms_pay_user_state'),
                ],
            },
        ),
    ]
