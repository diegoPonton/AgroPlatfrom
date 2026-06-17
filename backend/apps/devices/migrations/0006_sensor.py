from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0005_devicecommand'),
    ]

    operations = [
        migrations.CreateModel(
            name='Sensor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sensor_type', models.CharField(choices=[
                    ('SHTC3', 'SHTC3 — Temperatura/Humedad Ambiente'),
                    ('DS18B20', 'DS18B20 — Temperatura Sonda'),
                    ('GPS', 'GPS — Posición'),
                    ('BAT', 'Batería — Voltaje/Porcentaje'),
                ], max_length=20)),
                ('label', models.CharField(blank=True, max_length=100)),
                ('device', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='sensors',
                    to='devices.device',
                )),
            ],
        ),
    ]
