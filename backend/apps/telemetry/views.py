from django.utils import timezone
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from apps.devices.models import Device
from apps.users.models import Organization
from .models import TelemetryReading
from .serializers import TelemetryReadingSerializer


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def ingest(request):
    """Endpoint llamado por el receptor ESP32. Autentica por provisioning_token."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return Response({'detail': 'Token requerido.'}, status=401)

    token = auth_header[7:]
    try:
        receptor = Device.objects.get(provisioning_token=token)
    except Device.DoesNotExist:
        return Response({'detail': 'Token inválido.'}, status=401)

    data = request.data
    device_id = data.get('device_id')

    if not device_id:
        return Response({'detail': 'device_id requerido.'}, status=400)

    try:
        device = Device.objects.get(device_id=device_id)
    except Device.DoesNotExist:
        return Response({'detail': f'Dispositivo {device_id} no registrado.'}, status=404)

    rssi = data.get('rssi')

    now = timezone.now()

    reading = TelemetryReading.objects.create(
        device=device,
        payload=data,
        rssi=rssi,
        source_gateway=receptor.device_id,
    )

    # Actualizar last_seen tanto del emisor como del receptor que relayó el dato
    device.last_seen = now
    device.save(update_fields=['last_seen'])
    receptor.last_seen = now
    receptor.save(update_fields=['last_seen'])

    channel_layer = get_channel_layer()
    group_name = f'device_{device_id}'.replace(':', '_').replace('.', '_')
    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            'type': 'telemetry_message',
            'data': {
                'id': reading.id,
                'received_at': reading.received_at.isoformat(),
                'payload': data,
                'rssi': rssi,
            },
        }
    )

    return Response({'detail': 'ok'}, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_history(request, pk):
    """Historial de telemetría de un dispositivo."""
    org = Organization.objects.filter(members=request.user).first()
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    limit = int(request.query_params.get('limit', 100))
    readings = TelemetryReading.objects.filter(device=device)[:limit]
    return Response(TelemetryReadingSerializer(readings, many=True).data)
