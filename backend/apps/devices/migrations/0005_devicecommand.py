from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0004_device_assigned_gateway'),
    ]

    operations = [
        migrations.CreateModel(
            name='DeviceCommand',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('command_type', models.CharField(choices=[
                    ('set_sleep', 'Cambiar intervalo de envío'),
                    ('disable_sensor', 'Desactivar sensor'),
                    ('enable_sensor', 'Activar sensor'),
                    ('restart', 'Reiniciar dispositivo'),
                    ('set_lora_sf', 'Cambiar LoRa Spreading Factor'),
                    ('set_lora_power', 'Cambiar potencia LoRa (dBm)'),
                ], max_length=30)),
                ('params', models.JSONField(default=dict)),
                ('status', models.CharField(choices=[
                    ('pending', 'Pendiente'),
                    ('relayed', 'Retransmitido por receptor'),
                    ('acked', 'Confirmado por emisor'),
                    ('failed', 'Error'),
                ], default='pending', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('relayed_at', models.DateTimeField(blank=True, null=True)),
                ('acked_at', models.DateTimeField(blank=True, null=True)),
                ('emitter', models.ForeignKey(
                    limit_choices_to={'device_type': 'emisor'},
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='commands',
                    to='devices.device',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
