from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0010_drop_gy39_sensor_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='sensor',
            name='sensor_type',
            field=models.CharField(choices=[('SHTC3', 'SHTC3 — Temperatura/Humedad Ambiente (incl. placas GY-39)'), ('BME280', 'BME280 — Temperatura/Humedad/Presión Ambiente'), ('DS18B20', 'DS18B20 — Temperatura Sonda'), ('GPS', 'GPS — Posición'), ('BAT', 'Batería — Voltaje/Porcentaje')], max_length=20),
        ),
    ]
