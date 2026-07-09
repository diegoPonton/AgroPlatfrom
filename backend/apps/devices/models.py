import secrets as _secrets
from django.db import models
from django.utils import timezone
from datetime import timedelta
from apps.users.models import Organization


def _gen_token():
    return _secrets.token_hex(32)


class Device(models.Model):
    TYPE_CHOICES = [
        ('emisor', 'Emisor (Nodo Sensor)'),
        ('receptor', 'Receptor (Gateway)'),
    ]

    device_id = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=200)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='devices')
    device_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='emisor')
    firmware_version = models.CharField(max_length=50, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    # Provisioning token: el ESP32 usa esto como Bearer para POST /api/telemetry/
    provisioning_token = models.CharField(max_length=64, default=_gen_token, unique=True)
    # Configuración embebida en el firmware (WiFi, sensores, sleep, etc.)
    config = models.JSONField(default=dict, blank=True)
    # Receptor al que apunta este emisor (solo relevante para device_type='emisor')
    assigned_gateway = models.ForeignKey(
        'self',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_emitters',
        limit_choices_to={'device_type': 'receptor'},
    )
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_online(self):
        if not self.last_seen:
            return False
        if self.device_type == 'emisor':
            sleep_min = int(self.config.get('sleep_minutes', 10))
            threshold = timedelta(minutes=sleep_min + 2)
        else:
            # Receptor: siempre encendido, se actualiza con cada telemetría relayada
            threshold = timedelta(minutes=5)
        return timezone.now() - self.last_seen < threshold

    def __str__(self):
        return f"{self.name} ({self.device_id})"

    class Meta:
        ordering = ['-last_seen']


class DeviceCommand(models.Model):
    COMMAND_TYPES = [
        ('set_sleep', 'Cambiar intervalo de envío'),
        ('enable_sensor', 'Activar/desactivar sensor'),
        ('set_device_id', 'Cambiar ID de dispositivo'),
        ('restart', 'Reiniciar dispositivo'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pendiente'),
        ('relayed', 'Retransmitido por receptor'),
        ('acked', 'Confirmado por emisor'),
        ('failed', 'Error'),
    ]
    emitter = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name='commands',
        limit_choices_to={'device_type': 'emisor'},
    )
    command_type = models.CharField(max_length=30, choices=COMMAND_TYPES)
    params = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    relayed_at = models.DateTimeField(null=True, blank=True)
    acked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.command_type} → {self.emitter.name} [{self.status}]"


class Sensor(models.Model):
    SENSOR_TYPES = [
        ('SHTC3', 'SHTC3 — Temperatura/Humedad Ambiente (incl. placas GY-39)'),
        ('DS18B20', 'DS18B20 — Temperatura Sonda'),
        ('GPS', 'GPS — Posición'),
        ('BAT', 'Batería — Voltaje/Porcentaje'),
    ]

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name='sensors')
    sensor_type = models.CharField(max_length=20, choices=SENSOR_TYPES)
    label = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return f"{self.device.name} — {self.sensor_type}"
