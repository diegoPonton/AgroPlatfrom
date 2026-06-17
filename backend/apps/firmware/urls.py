from django.urls import path
from . import views

urlpatterns = [
    # Builds genéricos
    path('firmware/', views.firmware_list, name='firmware-list'),
    path('firmware/<int:pk>/status/', views.firmware_build_status, name='firmware-build-status'),
    path('firmware/<int:pk>/download/', views.firmware_download, name='firmware-download'),

    # Por device
    path('devices/<int:device_pk>/firmware-config/', views.device_firmware_config, name='device-firmware-config'),
    path('devices/<int:device_pk>/build/', views.build_for_device, name='device-build'),
    path('devices/<int:device_pk>/flash/', views.log_flash, name='device-flash'),
    path('devices/<int:device_pk>/flash-logs/', views.device_flash_logs, name='device-flash-logs'),
]
