from rest_framework import serializers
from .models import AlertRule, AlertEvent


class AlertRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertRule
        fields = (
            'id', 'sensor_path', 'operator', 'threshold',
            'channel', 'webhook_url', 'cooldown_minutes', 'is_active', 'created_at',
        )
        read_only_fields = ('created_at',)


class AlertEventSerializer(serializers.ModelSerializer):
    rule_description = serializers.CharField(source='rule.__str__', read_only=True)

    class Meta:
        model = AlertEvent
        fields = ('id', 'rule', 'rule_description', 'triggered_at', 'value', 'notified')
