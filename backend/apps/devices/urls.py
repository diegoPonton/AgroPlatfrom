from django.urls import path
from . import views

urlpatterns = [
    path('devices/', views.device_list, name='device-list'),
    path('devices/receptors/', views.receptor_list, name='receptor-list'),
    path('devices/topology/', views.topology, name='topology'),
    path('devices/gps-map/', views.gps_map, name='gps-map'),
    path('devices/<int:pk>/', views.device_detail, name='device-detail'),
    path('devices/<int:pk>/secrets/', views.device_secrets, name='device-secrets'),
    path('devices/<int:pk>/provision/', views.device_provision_info, name='device-provision'),
    path('devices/<int:pk>/gateway-stats/', views.gateway_stats, name='gateway-stats'),
    path('devices/<int:pk>/commands/', views.device_commands, name='device-commands'),
    path('devices/<int:pk>/rotate-token/', views.rotate_token, name='rotate-token'),
    path('commands/<int:cmd_id>/', views.command_detail, name='command-detail'),
    path('commands/<int:cmd_id>/ack/', views.command_ack, name='command-ack'),
    path('relay/', views.receptor_relay, name='receptor-relay'),
]
