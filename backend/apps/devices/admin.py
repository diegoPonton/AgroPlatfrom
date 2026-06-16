from django.contrib import admin
from .models import Device, Sensor


class SensorInline(admin.TabularInline):
    model = Sensor
    extra = 0


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ('name', 'device_id', 'device_type', 'is_online', 'last_seen', 'organization')
    list_filter = ('device_type', 'organization')
    inlines = [SensorInline]
