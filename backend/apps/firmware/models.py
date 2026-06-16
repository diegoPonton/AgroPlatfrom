from django.db import models
from apps.devices.models import Device


class FirmwareBuild(models.Model):
    TARGET_CHOICES = [('emisor', 'Emisor'), ('receptor', 'Receptor')]
    STATUS_CHOICES = [
        ('ready', 'Listo'),
        ('building', 'Compilando'),
        ('error', 'Error'),
    ]

    version = models.CharField(max_length=50)
    target = models.CharField(max_length=20, choices=TARGET_CHOICES)
    binary = models.FileField(upload_to='firmware/', null=True, blank=True)
    config_template = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    compiled_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ready')
    build_log = models.TextField(blank=True)

    def __str__(self):
        return f"{self.target} v{self.version}"

    class Meta:
        ordering = ['-compiled_at']


class FlashLog(models.Model):
    METHOD_CHOICES = [('usb_serial', 'USB Serial'), ('ota_wifi', 'OTA WiFi')]

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='flash_logs')
    firmware = models.ForeignKey(FirmwareBuild, on_delete=models.SET_NULL, null=True)
    flashed_at = models.DateTimeField(auto_now_add=True)
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    success = models.BooleanField(default=True)

    class Meta:
        ordering = ['-flashed_at']
