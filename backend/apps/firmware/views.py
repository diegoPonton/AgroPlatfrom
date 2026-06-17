import os
import shutil
import subprocess
import tempfile
import threading
import textwrap
from datetime import datetime

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_org(user):
    return Organization.objects.filter(members=user).first()


def _get_device(pk, org):
    return Device.objects.get(pk=pk, organization=org)


def _firmware_src():
    return env(
        'FIRMWARE_SOURCE_PATH',
        default=r'C:\Users\diego\OneDrive\Documentos\PlatformIO\Projects\agroESP32_firmware',
    )


def _build_tool():
    """'platformio' (default local) o 'arduino-cli' (Railway)."""
    return env('BUILD_TOOL', default='platformio')


# ---------------------------------------------------------------------------
# board_config.h generators
# ---------------------------------------------------------------------------

def _gen_emisor_board_config(cfg: dict) -> str:
    lora  = cfg.get('lora', {})
    i2c   = cfg.get('i2c', {})
    ds    = cfg.get('ds18b20', {})
    gps   = cfg.get('gps', {})
    bat   = cfg.get('battery', {})
    sens  = cfg.get('sensors_default', {})
    beh   = cfg.get('behavior', {})

    return textwrap.dedent(f"""\
        #pragma once
        // GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform — no editar a mano
        // {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}

        // --- LoRa SPI ---
        #define LORA_CS_PIN    {lora.get('cs_pin',   25)}
        #define LORA_RST_PIN   {lora.get('rst_pin',  14)}
        #define LORA_DIO0_PIN  {lora.get('dio0_pin', 26)}
        #define LORA_SCK_PIN   {lora.get('sck_pin',  18)}
        #define LORA_MISO_PIN  {lora.get('miso_pin', 19)}
        #define LORA_MOSI_PIN  {lora.get('mosi_pin', 23)}
        #define LORA_FREQ_MHZ  {float(lora.get('freq_mhz', 915.0)):.1f}f
        #define LORA_SF_DEFAULT   {lora.get('sf', 0)}
        #define LORA_TX_DBM       {lora.get('tx_dbm', 20)}
        #define LORA_SYNC_WORD    0x{int(lora.get('sync_word', 0x12)):02X}
        #define CMD_WINDOW_MS     {beh.get('cmd_window_ms', 7000)}

        // --- I2C ---
        #define I2C_SDA_PIN    {i2c.get('sda_pin', 21)}
        #define I2C_SCL_PIN    {i2c.get('scl_pin', 22)}

        // --- DS18B20 OneWire ---
        #define DS18B20_PIN        {ds.get('pin', 4)}
        #define DS18B20_RESOLUTION {ds.get('resolution', 12)}

        // --- GPS UART ---
        #define GPS_RX_PIN          {gps.get('rx_pin', 16)}
        #define GPS_TX_PIN          {gps.get('tx_pin', 17)}
        #define GPS_BAUD            {gps.get('baud', 9600)}
        #define GPS_TIMEOUT_COLD_S  {gps.get('timeout_cold_s', 60)}
        #define GPS_TIMEOUT_WARM_S  {gps.get('timeout_warm_s', 30)}
        #define GPS_MIN_SATS        {gps.get('min_sats', 3)}

        // --- Batería ADC ---
        #define BAT_ADC_PIN    {bat.get('adc_pin', 34)}
        #define BAT_VREF       {float(bat.get('vref', 3.3)):.1f}f
        #define BAT_ADC_MAX    {bat.get('adc_max', 4095)}
        #define BAT_DIV_RATIO  {float(bat.get('div_ratio', 2.0)):.1f}f
        #define BAT_SAMPLES    {bat.get('samples', 50)}
        #define BAT_V_MAX      {float(bat.get('v_max', 4.20)):.2f}f
        #define BAT_V_MIN      {float(bat.get('v_min', 3.20)):.2f}f

        // --- Sensores habilitados por defecto ---
        #define SENSOR_SHTC3_DEFAULT    {str(sens.get('shtc3',   True)).lower()}
        #define SENSOR_DS18B20_DEFAULT  {str(sens.get('ds18b20', True)).lower()}
        #define SENSOR_GPS_DEFAULT      {str(sens.get('gps',     True)).lower()}

        // --- Comportamiento ---
        #define DEFAULT_SLEEP_MIN  {beh.get('sleep_min', 10)}
    """)


def _gen_receptor_board_config(cfg: dict) -> str:
    lora = cfg.get('lora', {})
    net  = cfg.get('network', {})

    return textwrap.dedent(f"""\
        #pragma once
        // GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform — no editar a mano
        // {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}

        // --- LoRa SPI ---
        #define LORA_CS_PIN    {lora.get('cs_pin',   25)}
        #define LORA_RST_PIN   {lora.get('rst_pin',  14)}
        #define LORA_DIO0_PIN  {lora.get('dio0_pin', 26)}
        #define LORA_SCK_PIN   {lora.get('sck_pin',  18)}
        #define LORA_MISO_PIN  {lora.get('miso_pin', 19)}
        #define LORA_MOSI_PIN  {lora.get('mosi_pin', 23)}
        #define LORA_FREQ_MHZ  {float(lora.get('freq_mhz', 915.0)):.1f}f
        #define LORA_TX_DBM    {lora.get('tx_dbm', 13)}
        #define LORA_SYNC_WORD 0x{int(lora.get('sync_word', 0x12)):02X}

        // --- Comportamiento red ---
        #define WIFI_CONNECT_TIMEOUT_MS  {net.get('wifi_connect_timeout_ms', 15000)}
        #define WIFI_RETRY_MS            {net.get('wifi_retry_ms', 10000)}
        #define HTTP_POST_TIMEOUT_MS     {net.get('http_post_timeout_ms', 8000)}
        #define HTTP_RELAY_TIMEOUT_MS    {net.get('http_relay_timeout_ms', 4000)}
        #define HTTP_POST_RETRIES        {net.get('http_post_retries', 3)}
        #define HTTP_RETRY_DELAY_MS      {net.get('http_retry_delay_ms', 2000)}
    """)


def _gen_emisor_secrets(device: Device) -> str:
    return textwrap.dedent(f"""\
        #pragma once
        // GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform
        // Dispositivo : {device.name}
        // ID          : {device.device_id}
        // Tipo        : Emisor (Nodo Sensor)

        #define DEVICE_ID_SECRET  "{device.device_id}"
        #define SLEEP_MINUTES     {int(device.config.get('sleep_minutes', 10))}
    """)


def _gen_receptor_secrets(device: Device) -> str:
    cfg = device.config
    api_base = env('RAILWAY_PUBLIC_DOMAIN', default='')
    api_url = f"https://{api_base}/api/telemetry/" if api_base else cfg.get('api_url', '')

    return textwrap.dedent(f"""\
        #pragma once
        // GENERADO AUTOMÁTICAMENTE por AgroESP32 Platform
        // Dispositivo : {device.name}
        // ID          : {device.device_id}
        // Tipo        : Receptor (Gateway)

        // WiFi
        #define WIFI_SSID_SECRET  "{cfg.get('wifi_ssid', '')}"
        #define WIFI_PASS_SECRET  "{cfg.get('wifi_pass', '')}"

        // API AgroESP32
        #define API_URL_SECRET    "{api_url}"
        #define API_TOKEN_SECRET  "{device.provisioning_token}"
    """)


# ---------------------------------------------------------------------------
# Compilation runner
# ---------------------------------------------------------------------------

def _run_build(build_pk: int, target: str, device: Device):
    """Ejecuta la compilación en un hilo. Soporta PlatformIO y Arduino CLI."""
    try:
        build = FirmwareBuild.objects.get(pk=build_pk)
        firmware_src = _firmware_src()

        board_cfg = device.config.get('board', {})
        if target == 'emisor':
            board_config_h = _gen_emisor_board_config(board_cfg)
            secrets_h      = _gen_emisor_secrets(device)
        else:
            board_config_h = _gen_receptor_board_config(board_cfg)
            secrets_h      = _gen_receptor_secrets(device)

        # Compilar en directorio temporal para no contaminar el source con un
        # build paralelo de otro device
        with tempfile.TemporaryDirectory() as tmpdir:
            src_dir = os.path.join(firmware_src, 'src', target)
            shutil.copytree(firmware_src, tmpdir, dirs_exist_ok=True)

            tmp_src = os.path.join(tmpdir, 'src', target)
            with open(os.path.join(tmp_src, 'board_config.h'), 'w') as f:
                f.write(board_config_h)
            with open(os.path.join(tmp_src, 'secrets.h'), 'w') as f:
                f.write(secrets_h)

            build.build_log += f'Target: {target}  Device: {device.device_id}\n'
            build.build_log += f'Tool: {_build_tool()}\n'
            build.save(update_fields=['build_log'])

            tool = _build_tool()
            if tool == 'arduino-cli':
                fqbn = device.config.get('board', {}).get('fqbn', 'esp32:esp32:esp32doit-devkit-v1')
                cmd = ['arduino-cli', 'compile', '--fqbn', fqbn, '--export-binaries', tmp_src]
                bin_glob = os.path.join(tmp_src, 'build', fqbn.replace(':', '.'), '*.ino.bin')
            else:
                cmd = ['pio', 'run', '-e', target]
                bin_glob = os.path.join(tmpdir, '.pio', 'build', target, 'firmware.bin')

            build.build_log += f'Comando: {" ".join(cmd)}\n'
            build.save(update_fields=['build_log'])

            result = subprocess.run(
                cmd,
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=300,
            )

            log_output = (result.stdout + result.stderr)[-8000:]
            build.build_log += log_output

            if result.returncode != 0:
                build.status = 'error'
                build.build_log += f'\n❌ Build falló (código {result.returncode})'
                build.save()
                return

            # Encontrar el .bin generado
            import glob
            bins = glob.glob(bin_glob)
            if not bins:
                # PlatformIO fallback path
                alt = os.path.join(tmpdir, '.pio', 'build', target, 'firmware.bin')
                bins = [alt] if os.path.exists(alt) else []

            if not bins:
                build.status = 'error'
                build.build_log += f'\n❌ firmware.bin no encontrado'
                build.save()
                return

            bin_path = bins[0]
            filename  = f'firmware_{target}_{device.device_id}_v{build.version}.bin'
            with open(bin_path, 'rb') as f:
                build.binary.save(filename, File(f), save=False)

            build.status = 'ready'
            build.build_log += '\n✅ Compilación exitosa.'

    except subprocess.TimeoutExpired:
        build.status = 'error'
        build.build_log += '\n❌ Timeout (5 min)'
    except FirmwareBuild.DoesNotExist:
        return
    except Exception as exc:
        try:
            build = FirmwareBuild.objects.get(pk=build_pk)
            build.status = 'error'
            build.build_log += f'\n❌ Error: {exc}'
        except Exception:
            pass

    build.save()


# ---------------------------------------------------------------------------
# Views — firmware config
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def device_firmware_config(request, device_pk):
    """
    GET  → devuelve la config de hardware guardada en device.config['board']
    POST → guarda/actualiza config de hardware y genera preview de board_config.h
    """
    org = _get_org(request.user)
    try:
        device = _get_device(device_pk, org)
    except Device.DoesNotExist:
        return Response(status=404)

    if request.method == 'GET':
        return Response({
            'device_id':   device.device_id,
            'device_type': device.device_type,
            'board_config': device.config.get('board', {}),
        })

    # POST — guardar y retornar preview
    board_cfg = request.data.get('board', request.data)
    device.config['board'] = board_cfg
    device.save(update_fields=['config'])

    if device.device_type == 'emisor':
        preview = _gen_emisor_board_config(board_cfg)
    else:
        preview = _gen_receptor_board_config(board_cfg)

    return Response({
        'saved': True,
        'board_config_preview': preview,
    })


# ---------------------------------------------------------------------------
# Views — build por device
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def build_for_device(request, device_pk):
    """
    POST /api/devices/{pk}/build/
    Genera board_config.h + secrets.h del device, compila y devuelve build ID.
    Body opcional: { "version": "1.0.0" }
    """
    org = _get_org(request.user)
    try:
        device = _get_device(device_pk, org)
    except Device.DoesNotExist:
        return Response(status=404)

    target  = device.device_type
    version = request.data.get('version', '1.0.0')

    build = FirmwareBuild.objects.create(
        version=version,
        target=target,
        notes=f'Build automático para {device.name} ({device.device_id})',
        status='building',
        build_log=f'Iniciando build para {device.device_id}…\n',
        config_template=device.config.get('board', {}),
    )

    thread = threading.Thread(
        target=_run_build,
        args=(build.pk, target, device),
        daemon=True,
    )
    thread.start()

    return Response({'build_id': build.pk, 'status': 'building'}, status=202)


# ---------------------------------------------------------------------------
# Views — genéricos (sin device específico)
# ---------------------------------------------------------------------------

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
def firmware_build_status(request, pk):
    try:
        build = FirmwareBuild.objects.get(pk=pk)
    except FirmwareBuild.DoesNotExist:
        return Response(status=404)
    return Response({
        'id':        build.pk,
        'status':    build.status,
        'build_log': build.build_log,
        'version':   build.version,
        'target':    build.target,
        'has_binary': bool(build.binary),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def firmware_download(request, pk):
    try:
        build = FirmwareBuild.objects.get(pk=pk)
    except FirmwareBuild.DoesNotExist:
        return Response(status=404)
    if not build.binary:
        return Response({'detail': 'Binary no disponible aún.'}, status=404)
    return FileResponse(build.binary.open('rb'), as_attachment=True, filename=build.binary.name)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def log_flash(request, device_pk):
    org = _get_org(request.user)
    try:
        device = _get_device(device_pk, org)
    except Device.DoesNotExist:
        return Response(status=404)

    serializer = FlashLogSerializer(data=request.data)
    if serializer.is_valid():
        log = serializer.save(device=device)
        if log.firmware:
            device.firmware_version = log.firmware.version
            device.save(update_fields=['firmware_version'])
        return Response(FlashLogSerializer(log).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=400)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def device_flash_logs(request, device_pk):
    org = _get_org(request.user)
    try:
        device = _get_device(device_pk, org)
    except Device.DoesNotExist:
        return Response(status=404)
    logs = FlashLog.objects.filter(device=device)
    return Response(FlashLogSerializer(logs, many=True).data)
