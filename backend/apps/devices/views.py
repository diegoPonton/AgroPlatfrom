from django.db.models import OuterRef, Subquery, Count
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from decouple import config as env

from apps.users.models import Organization
from apps.telemetry.models import TelemetryReading
from .models import Device, DeviceCommand, _gen_token
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def rotate_token(request, pk):
    """Regenera el provisioning_token de un dispositivo."""
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)
    device.provisioning_token = _gen_token()
    device.save(update_fields=['provisioning_token'])
    return Response({'provisioning_token': device.provisioning_token})


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

    # Single subquery: latest RSSI per device
    latest_rssi_subq = TelemetryReading.objects.filter(
        device_id=OuterRef('pk')
    ).order_by('-received_at').values('rssi')[:1]

    latest_at_subq = TelemetryReading.objects.filter(
        device_id=OuterRef('pk')
    ).order_by('-received_at').values('received_at')[:1]

    devices = devices.annotate(
        last_rssi_val=Subquery(latest_rssi_subq),
        last_reading_at_val=Subquery(latest_at_subq),
    )

    # Pending commands count per emitter — single bulk query
    pending_map = dict(
        DeviceCommand.objects.filter(
            emitter__organization=org, status='pending'
        ).values('emitter_id').annotate(cnt=Count('id')).values_list('emitter_id', 'cnt')
    )

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
            data['last_rssi'] = d.last_rssi_val
            data['last_reading_at'] = d.last_reading_at_val.isoformat() if d.last_reading_at_val else None
            data['pending_commands'] = pending_map.get(d.id, 0)
        return data

    receptors = []
    unassigned = []

    device_list = list(devices)
    # Build emitter map per gateway
    emitter_map: dict[int, list] = {}
    for d in device_list:
        if d.device_type == 'emisor' and d.assigned_gateway_id:
            emitter_map.setdefault(d.assigned_gateway_id, []).append(d)

    for device in device_list:
        if device.device_type == 'receptor':
            entry = _base(device)
            emitters = emitter_map.get(device.id, [])
            entry['emitters'] = [_base(e) for e in emitters]
            rssi_vals = [e.last_rssi_val for e in emitters if e.last_rssi_val is not None]
            entry['avg_rssi'] = round(sum(rssi_vals) / len(rssi_vals)) if rssi_vals else None
            receptors.append(entry)
        elif device.device_type == 'emisor' and not device.assigned_gateway_id:
            unassigned.append(_base(device))

    return Response({'receptors': receptors, 'unassigned': unassigned})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def gateway_stats(request, pk):
    org = get_user_org(request)
    try:
        device = Device.objects.get(pk=pk, organization=org, device_type='receptor')
    except Device.DoesNotExist:
        return Response(status=404)

    readings_qs = TelemetryReading.objects.filter(source_gateway=device.device_id)
    total = readings_qs.count()

    today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = readings_qs.filter(received_at__gte=today).count()

    rssi_values = list(readings_qs.filter(rssi__isnull=False).values_list('rssi', flat=True)[:200])
    avg_rssi = round(sum(rssi_values) / len(rssi_values)) if rssi_values else None

    emitters = Device.objects.filter(
        assigned_gateway=device
    ).prefetch_related('sensors').annotate(
        last_rssi_val=Subquery(
            TelemetryReading.objects.filter(
                device_id=OuterRef('pk'), source_gateway=device.device_id
            ).order_by('-received_at').values('rssi')[:1]
        )
    )

    emitter_stats = [
        {
            'id': e.id,
            'name': e.name,
            'device_id': e.device_id,
            'is_online': e.is_online,
            'last_seen': e.last_seen.isoformat() if e.last_seen else None,
            'last_rssi': e.last_rssi_val,
            'sensors': [{'sensor_type': s.sensor_type} for s in e.sensors.all()],
        }
        for e in emitters
    ]

    recent = list(
        readings_qs.select_related('device').order_by('-received_at')[:60]
    )
    rssi_history = [
        {
            'received_at': r.received_at.isoformat(),
            'rssi': r.rssi,
            'device_id': r.device.device_id,
            'device_name': r.device.name,
        }
        for r in reversed(recent)
    ]

    activity = [
        {
            'received_at': r.received_at.isoformat(),
            'rssi': r.rssi,
            'device_id': r.device.device_id,
            'device_name': r.device.name,
            'payload_keys': list((r.payload or {}).keys()),
        }
        for r in readings_qs.select_related('device').order_by('-received_at')[:20]
    ]

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
def gps_map(request):
    """Returns all devices with their latest GPS position plus Haversine distances for connected pairs."""
    import math

    org = get_user_org(request)
    if not org:
        return Response({'detail': 'Sin organización asignada.'}, status=400)

    devices = Device.objects.filter(organization=org).prefetch_related('sensors')

    def _extract_gps(payload, config) -> dict | None:
        if payload:
            gps_blob = payload.get('gps') or payload.get('GPS') or {}
            if isinstance(gps_blob, dict):
                lat = gps_blob.get('lat') or gps_blob.get('latitude')
                lng = gps_blob.get('lng') or gps_blob.get('lon') or gps_blob.get('longitude')
                if lat is not None and lng is not None:
                    try:
                        return {
                            'lat': float(lat), 'lng': float(lng),
                            'alt': float(gps_blob['alt']) if gps_blob.get('alt') is not None else None,
                            'sats': gps_blob.get('sats'),
                            'hdop': gps_blob.get('hdop'),
                            'source': 'sensor',
                        }
                    except (TypeError, ValueError):
                        pass
            for lk, lonk in (('lat', 'lng'), ('lat', 'lon'), ('latitude', 'longitude')):
                lat = payload.get(lk)
                lng = payload.get(lonk)
                if lat is not None and lng is not None:
                    try:
                        return {'lat': float(lat), 'lng': float(lng), 'source': 'sensor'}
                    except (TypeError, ValueError):
                        pass
        if config:
            loc = config.get('location')
            if isinstance(loc, dict):
                lat, lng = loc.get('lat'), loc.get('lng')
                if lat is not None and lng is not None:
                    try:
                        return {'lat': float(lat), 'lng': float(lng), 'source': 'manual'}
                    except (TypeError, ValueError):
                        pass
        return None

    def _haversine(lat1, lng1, lat2, lng2) -> int:
        R = 6_371_000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
             + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
        return round(2 * R * math.asin(math.sqrt(min(1, a))))

    latest_payload_subq = TelemetryReading.objects.filter(
        device_id=OuterRef('pk')
    ).order_by('-received_at').values('payload')[:1]

    latest_rssi_subq = TelemetryReading.objects.filter(
        device_id=OuterRef('pk')
    ).order_by('-received_at').values('rssi')[:1]

    devices_ann = list(devices.annotate(
        latest_payload=Subquery(latest_payload_subq),
        last_rssi_val=Subquery(latest_rssi_subq),
    ))

    gps_by_id: dict[int, dict] = {}
    nodes = []
    for d in devices_ann:
        gps = _extract_gps(d.latest_payload, d.config)
        nodes.append({
            'id': d.id,
            'device_id': d.device_id,
            'name': d.name,
            'device_type': d.device_type,
            'is_online': d.is_online,
            'last_seen': d.last_seen.isoformat() if d.last_seen else None,
            'sensors': [{'sensor_type': s.sensor_type} for s in d.sensors.all()],
            'gps': gps,
            'last_rssi': d.last_rssi_val,
            'assigned_gateway_id': d.assigned_gateway_id,
            'config': d.config,
        })
        if gps:
            gps_by_id[d.id] = gps

    links = []
    for d in devices_ann:
        if d.device_type == 'emisor' and d.assigned_gateway_id:
            ge = gps_by_id.get(d.id)
            gr = gps_by_id.get(d.assigned_gateway_id)
            if ge and gr:
                links.append({
                    'emitter_id': d.id,
                    'receptor_id': d.assigned_gateway_id,
                    'distance_m': _haversine(ge['lat'], ge['lng'], gr['lat'], gr['lng']),
                })

    return Response({'nodes': nodes, 'links': links})


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


# Simple in-memory rate limiter using Django cache
def _check_rate_limit(key: str, max_calls: int = 30, window: int = 60) -> bool:
    """Returns True if allowed, False if rate limited."""
    from django.core.cache import cache
    cache_key = f'rl:{key}'
    current = cache.get(cache_key, 0)
    if current >= max_calls:
        return False
    cache.set(cache_key, current + 1, timeout=window)
    return True


@api_view(['GET'])
@permission_classes([AllowAny])
def receptor_relay(request):
    token = request.query_params.get('token', '')
    emitter_device_id = request.query_params.get('emitter', '')

    if not _check_rate_limit(f'relay:{token}', max_calls=60, window=60):
        return Response({'detail': 'Rate limit exceeded.'}, status=429)

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
    token = request.query_params.get('token')
    if not token:
        return Response({'detail': 'Token requerido.'}, status=401)

    if not _check_rate_limit(f'ack:{token}', max_calls=120, window=60):
        return Response({'detail': 'Rate limit exceeded.'}, status=429)

    try:
        cmd = DeviceCommand.objects.get(pk=cmd_id, emitter__provisioning_token=token)
    except DeviceCommand.DoesNotExist:
        return Response({'detail': 'No encontrado.'}, status=404)

    cmd.status = 'acked'
    cmd.acked_at = timezone.now()
    cmd.save(update_fields=['status', 'acked_at'])
    return Response({'ok': True})
