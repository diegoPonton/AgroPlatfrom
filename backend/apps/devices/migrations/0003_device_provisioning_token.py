import secrets
from django.db import migrations, models


def backfill_tokens(apps, schema_editor):
    Device = apps.get_model('devices', 'Device')
    for device in Device.objects.filter(provisioning_token=''):
        device.provisioning_token = secrets.token_hex(32)
        device.save(update_fields=['provisioning_token'])


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0002_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='device',
            name='provisioning_token',
            field=models.CharField(default='', max_length=64),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='device',
            name='provisioning_token',
            field=models.CharField(max_length=64, unique=True),
        ),
    ]
