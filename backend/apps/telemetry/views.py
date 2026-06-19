import ipaddress
import json
import operator as _op
import threading
from urllib.request import urlopen

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


def _get_client_ip(request) -> str:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return True


def _geolocate_receptor(receptor_pk: int, ip: str):
    """Background thread: locate receptor by public IP and store in config.location."""
    if _is_private_ip(ip):
        return
    try:
        with urlopen(f'http://ip-api.com/json/{ip}?fields=status,lat,lon,city,country', timeout=5) as r:
            data = json.loads(r.read())
        if data.get('status') != 'success':
            return
        receptor = Device.objects.get(pk=receptor_pk)
        cfg = dict(receptor.config or {})
        existing = cfg.get('location')
        # Don't overwrite a location the user set manually on the map
        if isinstance(existing, dict) and existing.get('source') == 'manual':
            return
        cfg['location'] = {
            'lat': data['lat'],
            'lng': data['lon'],
            'source': 'ip',
            'city': data.get('city', ''),
            'country': data.get('country', ''),
        }
        Device.objects.filter(pk=receptor_pk).update(config=cfg)
    except Exception:
        pass


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
        receptor = Device.objects.get(provisioning_token=token, device_type='receptor')
    except Device.DoesNotExist:
        return Response({'detail': 'Token inválido.'}, status=401)

    data = request.data
    device_id = data.get('device_id')
    if not device_id:
        return Response({'detail': 'device_id requerido.'}, status=400)

    try:
        device = Device.objects.get(
            device_id=device_id,
            organization=receptor.organization,  # must belong to same org
        )
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

    Device.objects.filter(pk=device.pk).update(last_seen=now)
    Device.objects.filter(pk=receptor.pk).update(last_seen=now)

    # Guardar canal ESP-NOW del receptor si lo reporta en el payload
    gw_channel = data.get('gw_channel')
    if gw_channel and isinstance(gw_channel, int) and 1 <= gw_channel <= 13:
        cfg = dict(receptor.config or {})
        if cfg.get('espnow_channel') != gw_channel:
            cfg['espnow_channel'] = gw_channel
            Device.objects.filter(pk=receptor.pk).update(config=cfg)

    # Auto-geolocate receptor by IP if no manual location is set
    existing_loc = (receptor.config or {}).get('location')
    if not isinstance(existing_loc, dict) or existing_loc.get('source') != 'manual':
        ip = _get_client_ip(request)
        threading.Thread(target=_geolocate_receptor, args=(receptor.pk, ip), daemon=True).start()

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

    _evaluate_alerts(device, data)

    return Response({'detail': 'ok'}, status=status.HTTP_201_CREATED)


def _evaluate_alerts(device, payload: dict):
    """Evaluate all active AlertRules for device against the incoming payload."""
    from apps.alerts.models import AlertRule, AlertEvent

    _OPS = {
        '>': _op.gt, '<': _op.lt,
        '>=': _op.ge, '<=': _op.le, '==': _op.eq,
    }

    rules = AlertRule.objects.filter(device=device, is_active=True)
    now = timezone.now()

    for rule in rules:
        # Cooldown check
        last = AlertEvent.objects.filter(rule=rule).only('triggered_at').first()
        if last:
            elapsed = (now - last.triggered_at).total_seconds()
            if elapsed < rule.cooldown_minutes * 60:
                continue

        # Resolve dot-path value from payload (e.g. "amb.temp_c")
        try:
            value = payload
            for key in rule.sensor_path.split('.'):
                value = value[key]
            value = float(value)
        except (KeyError, TypeError, ValueError):
            continue

        fn = _OPS.get(rule.operator)
        if fn and fn(value, rule.threshold):
            event = AlertEvent.objects.create(rule=rule, value=value)
            if rule.channel == 'webhook' and rule.webhook_url:
                threading.Thread(
                    target=_fire_webhook, args=(rule, event, device, value), daemon=True
                ).start()


def _fire_webhook(rule, event, device, value):
    try:
        import requests
        resp = requests.post(
            rule.webhook_url,
            json={
                'device_id': device.device_id,
                'device_name': device.name,
                'sensor_path': rule.sensor_path,
                'value': value,
                'operator': rule.operator,
                'threshold': rule.threshold,
                'triggered_at': event.triggered_at.isoformat(),
            },
            timeout=5,
        )
        if resp.ok:
            AlertEvent = event.__class__
            AlertEvent.objects.filter(pk=event.pk).update(notified=True)
    except Exception:
        pass


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_history(request, pk):
    """
    Historial de telemetría de un dispositivo.
    Query params:
      hours=N  — últimas N horas (1,6,12,24,48,96,168). Por defecto 24.
      limit=N  — cap de registros (máx 2000). Por defecto 500.
    """
    from django.utils import timezone
    from datetime import timedelta

    org = Organization.objects.filter(members=request.user).first()
    try:
        device = Device.objects.get(pk=pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    hours = min(int(request.query_params.get('hours', 24)), 168)
    limit = min(int(request.query_params.get('limit', 500)), 2000)
    since = timezone.now() - timedelta(hours=hours)

    readings = (
        TelemetryReading.objects
        .filter(device=device, received_at__gte=since)
        .order_by('received_at')[:limit]
    )
    return Response(TelemetryReadingSerializer(readings, many=True).data)
