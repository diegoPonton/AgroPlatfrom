import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0003_device_provisioning_token'),
    ]

    operations = [
        migrations.AddField(
            model_name='device',
            name='assigned_gateway',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='assigned_emitters',
                limit_choices_to={'device_type': 'receptor'},
                to='devices.device',
            ),
        ),
    ]
