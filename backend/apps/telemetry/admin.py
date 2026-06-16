from django.contrib import admin
from .models import TelemetryReading


@admin.register(TelemetryReading)
class TelemetryReadingAdmin(admin.ModelAdmin):
    list_display = ('device', 'received_at', 'rssi', 'source_gateway')
    list_filter = ('device',)
    readonly_fields = ('received_at', 'payload')
