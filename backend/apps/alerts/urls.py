from django.urls import path
from . import views

urlpatterns = [
    path('devices/<int:device_pk>/alerts/', views.alert_rules, name='alert-rules'),
    path('alerts/<int:pk>/', views.alert_rule_detail, name='alert-rule-detail'),
    path('alerts/events/', views.alert_events, name='alert-events'),
]
