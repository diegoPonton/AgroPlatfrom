from django.db import models
from apps.devices.models import Device


class AlertRule(models.Model):
    OPERATOR_CHOICES = [('>', '>'), ('<', '<'), ('>=', '>='), ('<=', '<='), ('==', '==')]
    CHANNEL_CHOICES = [('email', 'Email'), ('webhook', 'Webhook')]

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='alert_rules')
    sensor_path = models.CharField(max_length=100, help_text='ej. amb.temp_c, bat.pct')
    operator = models.CharField(max_length=5, choices=OPERATOR_CHOICES)
    threshold = models.FloatField()
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    webhook_url = models.URLField(blank=True)
    cooldown_minutes = models.PositiveIntegerField(default=30)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.device.name}: {self.sensor_path} {self.operator} {self.threshold}"


class AlertEvent(models.Model):
    rule = models.ForeignKey(AlertRule, on_delete=models.CASCADE, related_name='events')
    triggered_at = models.DateTimeField(auto_now_add=True)
    value = models.FloatField()
    notified = models.BooleanField(default=False)

    class Meta:
        ordering = ['-triggered_at']
