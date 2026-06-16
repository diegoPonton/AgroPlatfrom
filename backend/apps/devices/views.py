from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from decouple import config as env

from apps.users.models import Organization
from .models import Device, DeviceCommand
from .serializers import DeviceSerializer, DeviceCreateSerializer


def get_user_org(request):
    return Organization.objects.filter(members=request.user).first()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def device_list(request):
    org = get_user_org(request)
    if not org:
        return Response({'detail': 'Sin organización asignada.'}, status=400)

    if request.method == 'GET':
        devices = Device.objects.filter(organization=org).prefetch_related('sensors')
        return Response(DeviceSerializer(devices, many=True).data)

    serializer = DeviceCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    device = serializer.save(organization=org)
    return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def device_detail(request, pk):
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(DeviceSerializer(device).data)

    if request.method == 'PATCH':
        serializer = DeviceSerializer(device, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    device.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_secrets(request, pk):
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    api_url = env('API_PUBLIC_URL', default='http://localhost:8000')
    cfg = device.config

    if device.device_type == 'receptor':
        content = f"""#pragma once
// =====================================================
// GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform
// Dispositivo : {device.name}
// ID          : {device.device_id}
// Tipo        : Receptor (Gateway)
// =====================================================

// WiFi
#define WIFI_SSID_SECRET  "{cfg.get('wifi_ssid', '')}"
#define WIFI_PASS_SECRET  "{cfg.get('wifi_pass', '')}"

// API AgroESP32
#define API_URL_SECRET    "{api_url}/api/telemetry/"
#define API_TOKEN_SECRET  "{device.provisioning_token}"
"""
    else:
        content = f"""#pragma once
// =====================================================
// GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform
// Dispositivo : {device.name}
// ID          : {device.device_id}
// Tipo        : Emisor (Nodo Sensor)
// =====================================================

#define DEVICE_ID_SECRET  "{device.device_id}"
#define SLEEP_MINUTES     {cfg.get('sleep_minutes', 10)}
"""

    return HttpResponse(
        content,
        content_type='text/plain',
        headers={'Content-Disposition': f'attachment; filename="secrets.h"'},
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def topology(request):
    org = get_user_org(request)
    if not org:
        return Response({'detail': 'Sin organización asignada.'}, status=400)

    devices = Device.objects.filter(organization=org).prefetch_related('sensors')

    # Build last RSSI map for all emitters in one pass
    from apps.telemetry.models import TelemetryReading
    emitter_ids = [d.id for d in devices if d.device_type == 'emisor']
    rssi_map = {}
    if emitter_ids:
        # One query per emitter but bounded by device count
        for eid in emitter_ids:
            reading = TelemetryReading.objects.filter(device_id=eid).only('rssi', 'received_at').first()
            if reading:
                rssi_map[eid] = {'rssi': reading.rssi, 'received_at': reading.received_at.isoformat()}

    def _base(d):
        data = {
            'id': d.id,
            'device_id': d.device_id,
            'name': d.name,
            'is_online': d.is_online,
            'last_seen': d.last_seen.isoformat() if d.last_seen else None,
            'sensors': [{'sensor_type': s.sensor_type} for s in d.sensors.all()],
            'config': d.config,
        }
        if d.device_type == 'emisor':
            lr = rssi_map.get(d.id)
            data['last_rssi'] = lr['rssi'] if lr else None
            data['last_reading_at'] = lr['received_at'] if lr else None
            # pending command count
            data['pending_commands'] = DeviceCommand.objects.filter(
                emitter=d, status='pending'
            ).count()
        return data

    receptors = []
    unassigned = []

    for device in devices:
        if device.device_type == 'receptor':
            entry = _base(device)
            emitters = Device.objects.filter(
                assigned_gateway=device
            ).prefetch_related('sensors')
            entry['emitters'] = [_base(e) for e in emitters]
            # receptor stats: emitter RSSI summary
            rssi_values = [rssi_map[e.id]['rssi'] for e in emitters if e.id in rssi_map and rssi_map[e.id]['rssi'] is not None]
            entry['avg_rssi'] = round(sum(rssi_values) / len(rssi_values)) if rssi_values else None
            receptors.append(entry)
        elif device.device_type == 'emisor' and not device.assigned_gateway_id:
            unassigned.append(_base(device))

    return Response({'receptors': receptors, 'unassigned': unassigned})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def gateway_stats(request, pk):
    """Stats completas del receptor usado como gateway."""
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org, device_type='receptor')
    except Device.DoesNotExist:
        return Response(status=404)

    from apps.telemetry.models import TelemetryReading

    readings = TelemetryReading.objects.filter(source_gateway=device.device_id)
    total = readings.count()

    today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = readings.filter(received_at__gte=today).count()

    rssi_values = list(readings.filter(rssi__isnull=False).values_list('rssi', flat=True)[:200])
    avg_rssi = round(sum(rssi_values) / len(rssi_values)) if rssi_values else None

    emitters = Device.objects.filter(assigned_gateway=device).prefetch_related('sensors')
    emitter_stats = []
    for e in emitters:
        last = TelemetryReading.objects.filter(device=e, source_gateway=device.device_id).first()
        emitter_stats.append({
            'id': e.id,
            'name': e.name,
            'device_id': e.device_id,
            'is_online': e.is_online,
            'last_seen': e.last_seen.isoformat() if e.last_seen else None,
            'last_rssi': last.rssi if last else None,
            'sensors': [{'sensor_type': s.sensor_type} for s in e.sensors.all()],
        })

    # Last 60 readings for RSSI chart (all emitters combined)
    recent = readings.select_related('device').order_by('-received_at')[:60]
    rssi_history = [{
        'received_at': r.received_at.isoformat(),
        'rssi': r.rssi,
        'device_id': r.device.device_id,
        'device_name': r.device.name,
    } for r in reversed(list(recent))]

    # Last 20 for activity log
    activity = [{
        'received_at': r.received_at.isoformat(),
        'rssi': r.rssi,
        'device_id': r.device.device_id,
        'device_name': r.device.name,
        'payload_keys': list((r.payload or {}).keys()),
    } for r in readings.select_related('device').order_by('-received_at')[:20]]

    return Response({
        'total_relayed': total,
        'today_count': today_count,
        'avg_rssi': avg_rssi,
        'emitters': emitter_stats,
        'rssi_history': rssi_history,
        'activity': activity,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def receptor_list(request):
    org = get_user_org(request)
    if not org:
        return Response({'detail': 'Sin organización asignada.'}, status=400)
    receptors = Device.objects.filter(organization=org, device_type='receptor')
    return Response(DeviceSerializer(receptors, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_provision_info(request, pk):
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    api_url = env('API_PUBLIC_URL', default='http://localhost:8000')
    cfg = device.config

    if device.device_type == 'receptor':
        prov_payload = {
            'wifi_ssid': cfg.get('wifi_ssid', ''),
            'wifi_pass': cfg.get('wifi_pass', ''),
            'api_url': f'{api_url}/api/telemetry/',
            'api_token': device.provisioning_token,
        }
    else:
        prov_payload = {
            'device_id': device.device_id,
            'sleep_minutes': cfg.get('sleep_minutes', 10),
        }

    return Response({
        'device_id': device.device_id,
        'device_type': device.device_type,
        'provisioning_token': device.provisioning_token,
        'api_url': f'{api_url}/api/telemetry/',
        'wifi_ssid': cfg.get('wifi_ssid', ''),
        'sleep_minutes': cfg.get('sleep_minutes', 10),
        'provisioning_payload': prov_payload,
    })


# ─── Commands ─────────────────────────────────────────────────────────────────

def _cmd_dict(cmd):
    return {
        'id': cmd.id,
        'command_type': cmd.command_type,
        'command_label': cmd.get_command_type_display(),
        'params': cmd.params,
        'status': cmd.status,
        'created_at': cmd.created_at.isoformat(),
        'relayed_at': cmd.relayed_at.isoformat() if cmd.relayed_at else None,
        'acked_at': cmd.acked_at.isoformat() if cmd.acked_at else None,
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def device_commands(request, pk):
    """
    GET  /api/devices/<emitter_id>/commands/ — lista comandos del emisor
    POST /api/devices/<emitter_id>/commands/ — crea un nuevo comando
    """
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org, device_type='emisor')
    except Device.DoesNotExist:
        return Response({'detail': 'Emisor no encontrado.'}, status=404)

    if request.method == 'GET':
        cmds = DeviceCommand.objects.filter(emitter=device)
        return Response([_cmd_dict(c) for c in cmds])

    command_type = request.data.get('command_type')
    valid_types = [c[0] for c in DeviceCommand.COMMAND_TYPES]
    if command_type not in valid_types:
        return Response({'detail': f'command_type inválido. Opciones: {valid_types}'}, status=400)

    cmd = DeviceCommand.objects.create(
        emitter=device,
        command_type=command_type,
        params=request.data.get('params', {}),
    )
    return Response(_cmd_dict(cmd), status=201)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def command_detail(request, cmd_id):
    """
    PATCH /api/commands/<id>/ — actualiza estado (desde UI: cancelar)
    DELETE /api/commands/<id>/ — elimina comando pendiente
    """
    org = get_user_org(request)
    try:
        cmd = DeviceCommand.objects.get(pk=cmd_id, emitter__organization=org)
    except DeviceCommand.DoesNotExist:
        return Response(status=404)

    if request.method == 'DELETE':
        if cmd.status not in ('pending',):
            return Response({'detail': 'Solo se pueden eliminar comandos pendientes.'}, status=400)
        cmd.delete()
        return Response(status=204)

    new_status = request.data.get('status')
    if new_status in ('failed',):
        cmd.status = new_status
        cmd.save()
    return Response(_cmd_dict(cmd))


@api_view(['GET'])
@permission_classes([AllowAny])
def receptor_relay(request):
    """
    GET /api/relay/?token=<provisioning_token>&emitter=<emitter_device_id>

    El receptor llama esto justo tras un POST de telemetría exitoso.
    Devuelve los comandos pendientes SOLO para ese emisor y los marca como 'relayed'.
    El receptor los retransmite por LoRa mientras el emisor aún está despierto (~7s).
    """
    token = request.query_params.get('token', '')
    emitter_device_id = request.query_params.get('emitter', '')

    try:
        receptor = Device.objects.get(device_type='receptor', provisioning_token=token)
    except Device.DoesNotExist:
        return Response({'detail': 'No autorizado.'}, status=401)

    qs = DeviceCommand.objects.filter(
        emitter__assigned_gateway=receptor,
        status='pending',
    ).select_related('emitter')

    if emitter_device_id:
        qs = qs.filter(emitter__device_id=emitter_device_id)

    commands = []
    now = timezone.now()
    for cmd in qs:
        commands.append({
            'cmd_id': cmd.id,
            'type': cmd.command_type,
            'params': cmd.params,
        })
        cmd.status = 'relayed'
        cmd.relayed_at = now
        cmd.save(update_fields=['status', 'relayed_at'])

    return Response({'commands': commands})


@api_view(['POST'])
@permission_classes([AllowAny])
def command_ack(request, cmd_id):
    """
    POST /api/commands/<cmd_id>/ack/?token=<emitter_provisioning_token>
    El emisor confirma (ACK) que ejecutó el comando.
    """
    token = request.query_params.get('token')
    try:
        cmd = DeviceCommand.objects.get(pk=cmd_id, emitter__provisioning_token=token)
    except DeviceCommand.DoesNotExist:
        return Response({'detail': 'No encontrado.'}, status=404)

    cmd.status = 'acked'
    cmd.acked_at = timezone.now()
    cmd.save(update_fields=['status', 'acked_at'])
    return Response({'ok': True})
