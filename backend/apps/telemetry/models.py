from django.db import models
from apps.devices.models import Device


class TelemetryReading(models.Model):
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='readings')
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    payload = models.JSONField()
    rssi = models.IntegerField(null=True, blank=True)
    source_gateway = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ['-received_at']

    def __str__(self):
        return f"{self.device.device_id} @ {self.received_at}"
