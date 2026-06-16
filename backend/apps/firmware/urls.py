from django.urls import path
from . import views

urlpatterns = [
    path('firmware/', views.firmware_list, name='firmware-list'),
    path('firmware/build/', views.build_firmware, name='firmware-build'),
    path('firmware/<int:pk>/download/', views.firmware_download, name='firmware-download'),
    path('firmware/<int:pk>/status/', views.firmware_build_status, name='firmware-build-status'),
    path('devices/<int:device_pk>/flash/', views.log_flash, name='device-flash'),
    path('devices/<int:device_pk>/flash-logs/', views.device_flash_logs, name='device-flash-logs'),
]
