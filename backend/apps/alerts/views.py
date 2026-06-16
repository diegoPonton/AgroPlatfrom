from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.devices.models import Device
from apps.users.models import Organization
from .models import AlertRule, AlertEvent
from .serializers import AlertRuleSerializer, AlertEventSerializer


def get_device(request, device_pk):
    org = Organization.objects.filter(members=request.user).first()
    try:
        return Device.objects.get(pk=device_pk, organization=org)
    except Device.DoesNotExist:
        return None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def alert_rules(request, device_pk):
    device = get_device(request, device_pk)
    if not device:
        return Response(status=404)

    if request.method == 'GET':
        rules = AlertRule.objects.filter(device=device)
        return Response(AlertRuleSerializer(rules, many=True).data)

    serializer = AlertRuleSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save(device=device)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=400)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def alert_rule_detail(request, pk):
    try:
        rule = AlertRule.objects.get(pk=pk)
    except AlertRule.DoesNotExist:
        return Response(status=404)

    if request.method == 'PATCH':
        serializer = AlertRuleSerializer(rule, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=400)

    rule.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def alert_events(request):
    org = Organization.objects.filter(members=request.user).first()
    device_ids = Device.objects.filter(organization=org).values_list('id', flat=True)
    events = AlertEvent.objects.filter(rule__device_id__in=device_ids)[:100]
    return Response(AlertEventSerializer(events, many=True).data)
