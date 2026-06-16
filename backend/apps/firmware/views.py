import os
import subprocess
import threading

from django.core.files import File
from django.http import FileResponse
from decouple import config as env
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.devices.models import Device
from apps.users.models import Organization
from .models import FirmwareBuild, FlashLog
from .serializers import FirmwareBuildSerializer, FlashLogSerializer


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def firmware_list(request):
    if request.method == 'GET':
        builds = FirmwareBuild.objects.all()
        return Response(FirmwareBuildSerializer(builds, many=True).data)

    serializer = FirmwareBuildSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=400)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def firmware_download(request, pk):
    try:
        build = FirmwareBuild.objects.get(pk=pk)
    except FirmwareBuild.DoesNotExist:
        return Response(status=404)

    return FileResponse(build.binary.open('rb'), as_attachment=True, filename=build.binary.name)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def log_flash(request, device_pk):
    org = Organization.objects.filter(members=request.user).first()
    try:
        device = Device.objects.get(pk=device_pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    serializer = FlashLogSerializer(data=request.data)
    if serializer.is_valid():
        log = serializer.save(device=device)
        # Update firmware version on device
        if log.firmware:
            device.firmware_version = log.firmware.version
            device.save(update_fields=['firmware_version'])
        return Response(FlashLogSerializer(log).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=400)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_flash_logs(request, device_pk):
    org = Organization.objects.filter(members=request.user).first()
    try:
        device = Device.objects.get(pk=device_pk, organization=org)
    except Device.DoesNotExist:
        return Response(status=404)

    logs = FlashLog.objects.filter(device=device)
    return Response(FlashLogSerializer(logs, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def build_firmware(request):
    """Dispara compilación con PlatformIO en background. Devuelve 202 con el ID del build."""
    target = request.data.get('target', 'emisor')
    if target not in ('emisor', 'receptor'):
        return Response({'detail': 'target debe ser emisor o receptor.'}, status=400)

    version = request.data.get('version', '0.0.0')
    notes = request.data.get('notes', 'Auto-compilado desde la plataforma')

    build = FirmwareBuild.objects.create(
        version=version,
        target=target,
        notes=notes,
        status='building',
        build_log='Iniciando compilación con PlatformIO…\n',
    )

    thread = threading.Thread(target=_run_pio_build, args=(build.pk, target), daemon=True)
    thread.start()

    return Response({'id': build.pk, 'status': 'building'}, status=202)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def firmware_build_status(request, pk):
    """Polling de estado de compilación."""
    try:
        build = FirmwareBuild.objects.get(pk=pk)
    except FirmwareBuild.DoesNotExist:
        return Response(status=404)
    return Response({
        'id': build.pk,
        'status': build.status,
        'build_log': build.build_log,
        'version': build.version,
        'target': build.target,
    })


def _run_pio_build(build_pk: int, target: str):
    """Corre en un hilo separado. Llama a pio run y guarda el .bin resultante."""
    try:
        build = FirmwareBuild.objects.get(pk=build_pk)
        firmware_src = env(
            'FIRMWARE_SOURCE_PATH',
            default=r'C:\Users\diego\OneDrive\Documentos\PlatformIO\Projects\agroESP32_firmware',
        )

        build.build_log += f'Directorio fuente: {firmware_src}\n'
        build.build_log += f'Comando: pio run -e {target}\n'
        build.save(update_fields=['build_log'])

        result = subprocess.run(
            ['pio', 'run', '-e', target],
            cwd=firmware_src,
            capture_output=True,
            text=True,
            timeout=300,
        )

        log_output = (result.stdout + result.stderr)[-8000:]
        build.build_log += log_output

        if result.returncode == 0:
            bin_path = os.path.join(firmware_src, '.pio', 'build', target, 'firmware.bin')
            if os.path.exists(bin_path):
                with open(bin_path, 'rb') as f:
                    build.binary.save(f'firmware_{target}_v{build.version}.bin', File(f), save=False)
                build.status = 'ready'
                build.build_log += '\n✅ Compilación exitosa.'
            else:
                build.status = 'error'
                build.build_log += f'\n❌ Binary no encontrado en {bin_path}'
        else:
            build.status = 'error'
            build.build_log += f'\n❌ PlatformIO terminó con código {result.returncode}'

    except subprocess.TimeoutExpired:
        build.status = 'error'
        build.build_log += '\n❌ Timeout: la compilación tardó más de 5 minutos.'
    except FirmwareBuild.DoesNotExist:
        return
    except Exception as exc:
        build = FirmwareBuild.objects.get(pk=build_pk)
        build.status = 'error'
        build.build_log += f'\n❌ Error inesperado: {exc}'

    build.save()
