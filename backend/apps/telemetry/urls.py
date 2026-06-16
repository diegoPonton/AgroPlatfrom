from django.urls import path
from . import views

urlpatterns = [
    path('telemetry/', views.ingest, name='telemetry-ingest'),
    path('devices/<int:pk>/telemetry/', views.device_history, name='telemetry-history'),
]
