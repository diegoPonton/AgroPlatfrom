from rest_framework import serializers
from .models import TelemetryReading


class TelemetryReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = TelemetryReading
        fields = ('id', 'received_at', 'payload', 'rssi', 'source_gateway')
