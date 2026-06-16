from rest_framework import serializers
from .models import FirmwareBuild, FlashLog


class FirmwareBuildSerializer(serializers.ModelSerializer):
    class Meta:
        model = FirmwareBuild
        fields = ('id', 'version', 'target', 'binary', 'config_template', 'notes', 'compiled_at', 'status', 'build_log')
        read_only_fields = ('compiled_at', 'status', 'build_log')


class FlashLogSerializer(serializers.ModelSerializer):
    firmware_version = serializers.CharField(source='firmware.version', read_only=True)

    class Meta:
        model = FlashLog
        fields = ('id', 'firmware', 'firmware_version', 'flashed_at', 'method', 'success')
        read_only_fields = ('flashed_at',)
