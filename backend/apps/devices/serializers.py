from rest_framework import serializers
from .models import Device, Sensor


class SensorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sensor
        fields = ('id', 'sensor_type', 'label')


class DeviceSerializer(serializers.ModelSerializer):
    sensors = SensorSerializer(many=True, read_only=True)
    is_online = serializers.BooleanField(read_only=True)
    assigned_gateway_name = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = (
            'id', 'device_id', 'name', 'device_type',
            'firmware_version', 'last_seen', 'is_online',
            'provisioning_token', 'config', 'sensors', 'created_at',
            'assigned_gateway', 'assigned_gateway_name',
        )
        read_only_fields = ('last_seen', 'is_online', 'provisioning_token', 'created_at', 'assigned_gateway_name')

    def get_assigned_gateway_name(self, obj):
        if obj.assigned_gateway_id:
            return obj.assigned_gateway.name
        return None


class DeviceCreateSerializer(serializers.ModelSerializer):
    sensors = SensorSerializer(many=True, required=False)
    assigned_gateway = serializers.PrimaryKeyRelatedField(
        queryset=Device.objects.filter(device_type='receptor'),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = Device
        fields = ('device_id', 'name', 'device_type', 'config', 'sensors', 'assigned_gateway')

    def create(self, validated_data):
        sensors_data = validated_data.pop('sensors', [])
        device = Device.objects.create(**validated_data)
        for s in sensors_data:
            Sensor.objects.create(device=device, **s)
        return device
