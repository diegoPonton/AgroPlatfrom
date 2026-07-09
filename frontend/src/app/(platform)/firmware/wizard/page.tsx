'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { createDevice, getReceptors } from '@/lib/devices'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

type DeviceType = 'emisor' | 'receptor'
type WizardStep = 1 | 2 | 3 | 4

interface FirmwareBuild {
  id: number
  version: string
  target: DeviceType
  notes: string
  compiled_at: string
  status: 'ready' | 'building' | 'error'
  build_log: string
  has_binary?: boolean
  flash_offset?: number  // 0x0 = merged binary, 0x10000 = app only
}

interface CreatedDevice {
  id: number
  device_id: string
  name: string
  device_type: DeviceType
  provisioning_token: string
  config: Record<string, unknown>
  assigned_gateway_name: string | null
}

// Default board configs
const DEFAULT_LORA = { cs_pin: 25, rst_pin: 14, dio0_pin: 26, sck_pin: 18, miso_pin: 19, mosi_pin: 23, freq_mhz: 915.0, sf: 0, tx_dbm: 20, sync_word: 18 }
const DEFAULT_I2C  = { sda_pin: 21, scl_pin: 22 }
const DEFAULT_DS   = { pin: 4, resolution: 12 }
const DEFAULT_GPS  = { rx_pin: 16, tx_pin: 17, baud: 9600, timeout_cold_s: 60, timeout_warm_s: 30, min_sats: 3 }
const DEFAULT_BAT  = { adc_pin: 34, vref: 3.3, adc_max: 4095, div_ratio: 2.0, samples: 50, v_max: 4.2, v_min: 3.2 }
const DEFAULT_NET  = { wifi_connect_timeout_ms: 15000, wifi_retry_ms: 10000, http_post_timeout_ms: 8000, http_relay_timeout_ms: 4000, http_post_retries: 3, http_retry_delay_ms: 2000 }
const DEFAULT_BEH  = { sleep_min: 10, cmd_window_ms: 7000 }

const BOARDS = [
  { id: 'esp32doit-devkit-v1', label: 'ESP32 Dev Kit V1', fqbn: 'esp32:esp32:esp32doit-devkit-v1' },
  { id: 'ttgo-lora32',         label: 'TTGO LoRa32',      fqbn: 'esp32:esp32:ttgo-lora32-v1' },
  { id: 'heltec-wifi-lora-32', label: 'Heltec WiFi LoRa 32', fqbn: 'esp32:esp32:heltec_wifi_lora_32' },
  { id: 'custom',              label: 'Custom / Otro',    fqbn: 'esp32:esp32:esp32doit-devkit-v1' },
]

const SENSOR_OPTIONS = [
  { type: 'SHTC3',   label: 'SHTC3',   desc: 'Temp/Humedad Ambiente',     icon: '🌡️' },
  { type: 'GY39',    label: 'GY-39',   desc: 'Temp/Hum/Presión (BME280)', icon: '🌦️' },
  { type: 'DS18B20', label: 'DS18B20', desc: 'Temperatura Sonda',         icon: '🔌' },
  { type: 'GPS',     label: 'GPS',     desc: 'Posición GPS',              icon: '📍' },
  { type: 'BAT',     label: 'BAT',     desc: 'Batería (ADC)',             icon: '🔋' },
]

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ current }: { current: WizardStep }) {
  const steps = ['Tipo', 'Configurar', 'Compilar', 'Flash']
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = (i + 1) as WizardStep
        const done   = n < current
        const active = n === current
        return (
          <div key={n} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active ? 'bg-green-600 text-white' :
              done   ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                active ? 'bg-white text-green-600' :
                done   ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-500'
              }`}>
                {done ? '✓' : n}
              </span>
              {label}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, badge, children, defaultOpen = false }: { title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{badge}</span>}
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 py-4 space-y-3 border-t">{children}</div>}
    </div>
  )
}

// ─── Pin row ──────────────────────────────────────────────────────────────────

function PinRow({ label, value, onChange, note }: { label: string; value: number; onChange: (v: number) => void; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 text-xs text-muted-foreground shrink-0">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-20 border rounded px-2 py-1 text-sm text-center"
      />
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FirmwareWizardPage() {
  const router = useRouter()
  const qc = useQueryClient()

  const [step, setStep]           = useState<WizardStep>(1)
  const [deviceType, setDeviceType] = useState<DeviceType>('emisor')
  const [selectedSensors, setSelectedSensors] = useState(['SHTC3', 'DS18B20', 'BAT'])
  const [assignedGateway, setAssignedGateway] = useState('')
  const [selectedBoard, setSelectedBoard]     = useState(BOARDS[0].id)
  const [createdDevice, setCreatedDevice]     = useState<CreatedDevice | null>(null)
  const [selectedBuild, setSelectedBuild]     = useState<FirmwareBuild | null>(null)
  const [buildingId, setBuildingId]           = useState<number | null>(null)
  const [buildLog, setBuildLog]               = useState('')
  const [buildStatus, setBuildStatus]         = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [boardPreview, setBoardPreview]       = useState('')

  // Board config state (pines y parámetros de hardware)
  const [lora, setLora] = useState({ ...DEFAULT_LORA })
  const [i2c,  setI2c]  = useState({ ...DEFAULT_I2C })
  const [ds,   setDs]   = useState({ ...DEFAULT_DS })
  const [gps,  setGps]  = useState({ ...DEFAULT_GPS })
  const [bat,  setBat]  = useState({ ...DEFAULT_BAT })
  const [net,  setNet]  = useState({ ...DEFAULT_NET })
  const [beh,  setBeh]  = useState({ ...DEFAULT_BEH })

  // Flash state
  const [flashStatus, setFlashStatus] = useState<'idle' | 'connecting' | 'downloading' | 'flashing' | 'provisioning' | 'done' | 'error'>('idle')
  const [flashProgress, setFlashProgress] = useState(0)
  const [flashLogs, setFlashLogs] = useState<string[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)

  const { data: receptors = [] } = useQuery({
    queryKey: ['receptors'],
    queryFn: getReceptors,
    enabled: deviceType === 'emisor',
  })

  const { data: firmwareList = [] } = useQuery<FirmwareBuild[]>({
    queryKey: ['firmware'],
    queryFn: async () => { const { data } = await api.get('/api/firmware/'); return data },
  })

  // Poll build status while building
  useEffect(() => {
    if (!buildingId || buildStatus !== 'building') return
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/firmware/${buildingId}/status/`)
        setBuildLog(data.build_log)
        if (data.status === 'ready') {
          setBuildStatus('ready')
          qc.invalidateQueries({ queryKey: ['firmware'] })
          clearInterval(interval)
          toast.success('¡Firmware compilado exitosamente!')
        } else if (data.status === 'error') {
          setBuildStatus('error')
          clearInterval(interval)
          toast.error('Error en la compilación')
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [buildingId, buildStatus, qc])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [flashLogs])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function buildBoardConfig() {
    return {
      fqbn: BOARDS.find(b => b.id === selectedBoard)?.fqbn ?? BOARDS[0].fqbn,
      lora,
      i2c,
      ds18b20: ds,
      gps,
      battery: bat,
      network: net,
      behavior: beh,
      sensors_default: {
        shtc3:   selectedSensors.includes('SHTC3'),
        gy39:    selectedSensors.includes('GY39'),
        ds18b20: selectedSensors.includes('DS18B20'),
        gps:     selectedSensors.includes('GPS'),
      },
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createDeviceMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: async (device) => {
      const d = device as unknown as CreatedDevice
      setCreatedDevice(d)
      qc.invalidateQueries({ queryKey: ['devices'] })

      // Guardar board config y obtener preview de board_config.h
      try {
        const { data } = await api.post(`/api/devices/${d.id}/firmware-config/`, { board: buildBoardConfig() })
        if (data.board_config_preview) setBoardPreview(data.board_config_preview)
      } catch { /* board config guardada de todas formas al compilar */ }

      setStep(3)
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data
      let msg = 'Error al crear el dispositivo'
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const parts = Object.entries(data as Record<string, unknown>).map(([k, v]) =>
          `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`
        )
        if (parts.length) msg = parts.join(' | ')
      }
      toast.error(msg)
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleStep2Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const config: Record<string, unknown> = {
      sleep_minutes: beh.sleep_min,
      board: buildBoardConfig(),
    }
    if (deviceType === 'receptor') {
      config.wifi_ssid = form.get('wifi_ssid') as string
      config.wifi_pass = form.get('wifi_pass') as string
    }
    createDeviceMutation.mutate({
      device_id: form.get('device_id') as string,
      name:      form.get('name') as string,
      device_type: deviceType,
      config,
      sensors: deviceType === 'emisor'
        ? selectedSensors.map((t) => ({ sensor_type: t, label: '' }))
        : [],
      assigned_gateway: deviceType === 'emisor' && assignedGateway ? Number(assignedGateway) : null,
    })
  }

  async function handleCompile() {
    if (!createdDevice) return
    setBuildStatus('building')
    setBuildLog('Iniciando compilación…')
    try {
      // Guardar board config actualizada antes de compilar
      await api.post(`/api/devices/${createdDevice.id}/firmware-config/`, { board: buildBoardConfig() })
      // Usar endpoint por device (genera board_config.h + secrets.h automáticamente)
      const { data } = await api.post(`/api/devices/${createdDevice.id}/build/`, { version: '1.0.0' })
      setBuildingId(data.build_id)
    } catch {
      setBuildStatus('error')
      toast.error('No se pudo iniciar la compilación')
    }
  }

  function selectBuildAndContinue(build: FirmwareBuild) {
    setSelectedBuild(build)
    setStep(4)
  }

  function addLog(msg: string) {
    setFlashLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  async function handleFlash() {
    if (!selectedBuild || !createdDevice) return
    if (!('serial' in navigator)) {
      toast.error('Web Serial no disponible. Usá Chrome o Edge.')
      return
    }

    setFlashLogs([])
    setFlashProgress(0)
    setFlashStatus('connecting')
    addLog('Solicitando acceso al puerto serial…')

    let port: SerialPort | null = null
    try {
      const { data: provInfo } = await api.get(`/api/devices/${createdDevice.id}/provision/`)
      const provPayload = provInfo.provisioning_payload

      port = await (navigator as Navigator & { serial: { requestPort: () => Promise<SerialPort> } }).serial.requestPort()
      addLog('Puerto seleccionado.')

      setFlashStatus('downloading')
      addLog(`Descargando firmware v${selectedBuild.version}…`)
      const response = await api.get(`/api/firmware/${selectedBuild.id}/download/`, { responseType: 'arraybuffer' })
      const binary = new Uint8Array(response.data as ArrayBuffer)
      addLog(`Firmware: ${(binary.length / 1024).toFixed(1)} KB`)

      setFlashStatus('flashing')
      const { ESPLoader, Transport } = await import('esptool-js')
      const transport = new Transport(port)
      const loader = new ESPLoader({
        transport, baudrate: 115200,
        terminal: { clean() {}, writeLine(d: string) { addLog(d) }, write(d: string) { addLog(d) } },
        enableTracing: false,
      })

      addLog('Conectando al chip…')
      const chip = await loader.main()
      addLog(`Chip detectado: ${chip}`)
      addLog('Borrando flash…')
      await loader.eraseFlash()
      addLog('Escribiendo firmware…')
      await loader.writeFlash({
        fileArray: [{ data: binary, address: selectedBuild.flash_offset ?? 0x0 }],
        flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
        eraseAll: false, compress: true,
        reportProgress: (_: number, written: number, total: number) => {
          const pct = Math.round((written / total) * 100)
          setFlashProgress(pct)
          if (pct % 20 === 0) addLog(`Progreso: ${pct}%`)
        },
      })
      addLog('Firmware escrito. Reiniciando…')
      await loader.after('hard_reset')
      await transport.disconnect()

      setFlashStatus('provisioning')
      addLog('Esperando modo provisioning del ESP32…')
      await new Promise((r) => setTimeout(r, 2000))
      await port.open({ baudRate: 115200 })
      const provOk = await sendProvisioningConfig(port, provPayload, addLog)
      await port.close()

      if (provOk) addLog('PROV_OK — ESP32 configurado y reiniciando.')
      else addLog('Sin PROV_READY — firmware usa config existente (secrets.h). OK.')

      setFlashStatus('done')
      setFlashProgress(100)
      addLog('✅ ¡Listo! El nodo está operativo.')

      await api.post(`/api/devices/${createdDevice.id}/flash/`, {
        firmware: selectedBuild.id, method: 'usb_serial', success: true,
      })
      toast.success('¡Nodo configurado correctamente!')

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ Error: ${msg}`)
      setFlashStatus('error')
      if (createdDevice && selectedBuild) {
        await api.post(`/api/devices/${createdDevice.id}/flash/`, {
          firmware: selectedBuild.id, method: 'usb_serial', success: false,
        }).catch(() => {})
      }
      if (port) {
        try { if (port.readable || port.writable) await port.close() } catch { /* ignore */ }
      }
    }
  }

  const compatibleBuilds = firmwareList.filter(
    (b) => b.target === deviceType && b.status === 'ready' && b.has_binary,
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground mb-2">
          ← Volver
        </button>
        <h1 className="text-2xl font-bold">Asistente de nuevo nodo</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configurá y flasheá tu ESP32 sin abrir PlatformIO.</p>
      </div>

      <Steps current={step} />

      {/* ── Step 1: Tipo ─────────────────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">¿Qué tipo de nodo vas a crear?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {(['emisor', 'receptor'] as DeviceType[]).map((t) => (
                <button key={t} onClick={() => setDeviceType(t)}
                  className={`p-5 rounded-xl border-2 text-left transition-all ${
                    deviceType === t ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                  <div className="text-3xl mb-2">{t === 'emisor' ? '📡' : '🔌'}</div>
                  <div className="font-semibold text-sm capitalize mb-1">{t}</div>
                  <div className="text-xs text-muted-foreground">
                    {t === 'emisor'
                      ? 'Lee sensores y envía datos por LoRa al receptor.'
                      : 'Recibe datos LoRa y los reenvía al servidor por WiFi.'}
                  </div>
                </button>
              ))}
            </div>
            <Button onClick={() => setStep(2)} className="w-full">Continuar →</Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Configurar ───────────────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Configurar {deviceType === 'emisor' ? '📡 Emisor' : '🔌 Receptor'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep2Submit} className="space-y-5">

              {/* Identidad */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Nombre del nodo</Label>
                  <Input id="name" name="name" placeholder={deviceType === 'emisor' ? 'Parcela Norte — Suelo' : 'Gateway Invernadero A'} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="device_id">ID único <span className="text-xs text-muted-foreground">(se graba en el firmware)</span></Label>
                  <Input id="device_id" name="device_id" placeholder={deviceType === 'emisor' ? 'nodo-norte-001' : 'gateway-inv-a'} required />
                </div>
              </div>

              {/* Placa */}
              <div className="space-y-1">
                <Label>Placa ESP32</Label>
                <div className="grid grid-cols-2 gap-2">
                  {BOARDS.map((b) => (
                    <button key={b.id} type="button" onClick={() => setSelectedBoard(b.id)}
                      className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                        selectedBoard === b.id ? 'border-green-500 bg-green-50 text-green-800 font-medium' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                      {b.label}
                      <div className="text-xs text-muted-foreground font-normal">{b.fqbn.split(':')[2]}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sensores (solo emisor) */}
              {deviceType === 'emisor' && (
                <div className="space-y-2">
                  <Label>Sensores instalados</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {SENSOR_OPTIONS.map(({ type, label, desc, icon }) => {
                      const active = selectedSensors.includes(type)
                      return (
                        <button key={type} type="button"
                          onClick={() => setSelectedSensors((prev) =>
                            prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type])}
                          className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                            active ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                          }`}>
                          <span className="text-lg">{icon}</span>
                          <div>
                            <div className={`text-xs font-semibold ${active ? 'text-green-700' : 'text-gray-600'}`}>{label}</div>
                            <div className="text-xs text-muted-foreground">{desc}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Comportamiento */}
              {deviceType === 'emisor' && (
                <div className="space-y-1">
                  <Label>Intervalo de envío (minutos)</Label>
                  <input
                    type="number" min={1} max={60} value={beh.sleep_min}
                    onChange={e => setBeh(b => ({ ...b, sleep_min: Number(e.target.value) }))}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">El nodo entra en deep sleep entre lecturas para ahorrar batería.</p>
                </div>
              )}

              {/* WiFi (receptor) */}
              {deviceType === 'receptor' && (
                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-800">🔌 Credenciales WiFi</p>
                  <div className="space-y-1">
                    <Label htmlFor="wifi_ssid">Red WiFi (SSID)</Label>
                    <Input id="wifi_ssid" name="wifi_ssid" placeholder="Mi_Red_WiFi" required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wifi_pass">Contraseña</Label>
                    <Input id="wifi_pass" name="wifi_pass" type="password" placeholder="••••••••" />
                  </div>
                </div>
              )}

              {/* Receptor asignado (emisor) */}
              {deviceType === 'emisor' && (
                <div className="space-y-1">
                  <Label>Receptor asignado</Label>
                  {receptors.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      No hay receptores. Podés asignar uno más tarde desde la topología.
                    </p>
                  ) : (
                    <select value={assignedGateway} onChange={e => setAssignedGateway(e.target.value)}
                      className="w-full border rounded-md px-3 py-2 text-sm">
                      <option value="">Sin asignar</option>
                      {receptors.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} ({r.device_id})</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* ── Hardware Config (avanzado) ── */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Configuración de hardware</p>

                <Section title="LoRa — Pines SPI" badge="RFM95W / SX1276">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <PinRow label="CS (NSS)" value={lora.cs_pin}   onChange={v => setLora(l => ({...l, cs_pin: v}))} />
                    <PinRow label="RST"      value={lora.rst_pin}  onChange={v => setLora(l => ({...l, rst_pin: v}))} />
                    <PinRow label="DIO0"     value={lora.dio0_pin} onChange={v => setLora(l => ({...l, dio0_pin: v}))} />
                    <PinRow label="SCK"      value={lora.sck_pin}  onChange={v => setLora(l => ({...l, sck_pin: v}))} />
                    <PinRow label="MISO"     value={lora.miso_pin} onChange={v => setLora(l => ({...l, miso_pin: v}))} />
                    <PinRow label="MOSI"     value={lora.mosi_pin} onChange={v => setLora(l => ({...l, mosi_pin: v}))} />
                  </div>
                </Section>

                <Section title="LoRa — Parámetros RF">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-xs text-muted-foreground shrink-0">Frecuencia (MHz)</label>
                      <input type="number" step="0.1" value={lora.freq_mhz}
                        onChange={e => setLora(l => ({...l, freq_mhz: Number(e.target.value)}))}
                        className="w-24 border rounded px-2 py-1 text-sm text-center" />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-xs text-muted-foreground shrink-0">SF (7=default)</label>
                      <input type="number" min={0} max={12} value={lora.sf}
                        onChange={e => setLora(l => ({...l, sf: Number(e.target.value)}))}
                        className="w-20 border rounded px-2 py-1 text-sm text-center" />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-xs text-muted-foreground shrink-0">TX dBm (2-20)</label>
                      <input type="number" min={2} max={20} value={lora.tx_dbm}
                        onChange={e => setLora(l => ({...l, tx_dbm: Number(e.target.value)}))}
                        className="w-20 border rounded px-2 py-1 text-sm text-center" />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="w-28 text-xs text-muted-foreground shrink-0">Sync Word</label>
                      <input type="number" value={lora.sync_word}
                        onChange={e => setLora(l => ({...l, sync_word: Number(e.target.value)}))}
                        className="w-20 border rounded px-2 py-1 text-sm text-center" />
                      <span className="text-xs text-muted-foreground">18=0x12 privado</span>
                    </div>
                  </div>
                </Section>

                {deviceType === 'emisor' && (
                  <>
                    {selectedSensors.some(s => ['SHTC3'].includes(s)) && (
                      <Section title="I2C — SHTC3 y otros">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          <PinRow label="SDA" value={i2c.sda_pin} onChange={v => setI2c(c => ({...c, sda_pin: v}))} />
                          <PinRow label="SCL" value={i2c.scl_pin} onChange={v => setI2c(c => ({...c, scl_pin: v}))} />
                        </div>
                      </Section>
                    )}

                    {selectedSensors.includes('DS18B20') && (
                      <Section title="DS18B20 — OneWire">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          <PinRow label="Data Pin" value={ds.pin} onChange={v => setDs(d => ({...d, pin: v}))} />
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Resolución (bits)</label>
                            <select value={ds.resolution} onChange={e => setDs(d => ({...d, resolution: Number(e.target.value)}))}
                              className="w-20 border rounded px-2 py-1 text-sm">
                              {[9,10,11,12].map(r => <option key={r} value={r}>{r}-bit</option>)}
                            </select>
                          </div>
                        </div>
                      </Section>
                    )}

                    {selectedSensors.includes('GPS') && (
                      <Section title="GPS — UART">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          <PinRow label="RX Pin" value={gps.rx_pin} onChange={v => setGps(g => ({...g, rx_pin: v}))} note="ESP32 recibe de GPS TX" />
                          <PinRow label="TX Pin" value={gps.tx_pin} onChange={v => setGps(g => ({...g, tx_pin: v}))} />
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Baud Rate</label>
                            <select value={gps.baud} onChange={e => setGps(g => ({...g, baud: Number(e.target.value)}))}
                              className="border rounded px-2 py-1 text-sm">
                              {[4800, 9600, 38400, 115200].map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Timeout cold (s)</label>
                            <input type="number" value={gps.timeout_cold_s} onChange={e => setGps(g => ({...g, timeout_cold_s: Number(e.target.value)}))}
                              className="w-20 border rounded px-2 py-1 text-sm text-center" />
                          </div>
                        </div>
                      </Section>
                    )}

                    {selectedSensors.includes('BAT') && (
                      <Section title="Batería — ADC">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                          <PinRow label="ADC Pin" value={bat.adc_pin} onChange={v => setBat(b => ({...b, adc_pin: v}))} note="Solo ADC1 (GPIO32-39)" />
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Divisor ratio</label>
                            <input type="number" step="0.1" value={bat.div_ratio} onChange={e => setBat(b => ({...b, div_ratio: Number(e.target.value)}))}
                              className="w-20 border rounded px-2 py-1 text-sm text-center" />
                            <span className="text-xs text-muted-foreground">R1=R2 → 2.0</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Voltaje máx (V)</label>
                            <input type="number" step="0.05" value={bat.v_max} onChange={e => setBat(b => ({...b, v_max: Number(e.target.value)}))}
                              className="w-20 border rounded px-2 py-1 text-sm text-center" />
                            <span className="text-xs text-muted-foreground">Li-Ion=4.2</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="w-28 text-xs text-muted-foreground shrink-0">Voltaje mín (V)</label>
                            <input type="number" step="0.05" value={bat.v_min} onChange={e => setBat(b => ({...b, v_min: Number(e.target.value)}))}
                              className="w-20 border rounded px-2 py-1 text-sm text-center" />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          ⚠️ Rango ADC = Vbat / ratio → debe ser ≤ {(3.3).toFixed(1)}V.
                          Con ratio {bat.div_ratio}: rango = {(bat.v_max / bat.div_ratio).toFixed(2)}V {bat.v_max / bat.div_ratio <= 3.3 ? '✓' : '❌ PELIGRO'}
                        </p>
                      </Section>
                    )}
                  </>
                )}

                {deviceType === 'receptor' && (
                  <Section title="Red — Timeouts HTTP">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <div className="flex items-center gap-3">
                        <label className="w-28 text-xs text-muted-foreground shrink-0">POST timeout (ms)</label>
                        <input type="number" value={net.http_post_timeout_ms} onChange={e => setNet(n => ({...n, http_post_timeout_ms: Number(e.target.value)}))}
                          className="w-24 border rounded px-2 py-1 text-sm text-center" />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="w-28 text-xs text-muted-foreground shrink-0">Reintentos POST</label>
                        <input type="number" min={1} max={10} value={net.http_post_retries} onChange={e => setNet(n => ({...n, http_post_retries: Number(e.target.value)}))}
                          className="w-20 border rounded px-2 py-1 text-sm text-center" />
                      </div>
                    </div>
                  </Section>
                )}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                  ← Atrás
                </button>
                <Button type="submit" disabled={createDeviceMutation.isPending} className="flex-1">
                  {createDeviceMutation.isPending ? 'Creando…' : 'Crear dispositivo y continuar →'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Compilar ─────────────────────────────────────────────────── */}
      {step === 3 && createdDevice && (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="py-3 text-sm text-green-800">
              ✅ Dispositivo <strong>{createdDevice.name}</strong> registrado.
              ID: <code className="bg-green-100 px-1 rounded text-xs">{createdDevice.device_id}</code>
            </CardContent>
          </Card>

          {/* Preview de board_config.h */}
          {boardPreview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>board_config.h generado</span>
                  <Badge variant="outline" className="text-xs font-mono">{createdDevice.device_type}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto">
                  {boardPreview}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Builds existentes */}
          {compatibleBuilds.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Usar firmware existente</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {compatibleBuilds.map((b) => (
                  <button key={b.id} onClick={() => selectBuildAndContinue(b)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">v{b.version}</span>
                      <Badge variant="outline" className="text-xs">{b.target}</Badge>
                    </div>
                    {b.notes && <p className="text-xs text-muted-foreground mt-0.5">{b.notes}</p>}
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Compilar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compilar firmware para este dispositivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Genera el <code className="text-xs bg-gray-100 px-1 rounded">.bin</code> con los pines y parámetros que configuraste.
                Tarda ~60 segundos.
              </p>

              {buildStatus === 'idle' && (
                <Button onClick={handleCompile} className="w-full">
                  ⚡ Compilar firmware personalizado
                </Button>
              )}

              {buildStatus === 'building' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Compilando…
                  </div>
                  {buildLog && (
                    <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-green-400 max-h-48 overflow-y-auto">
                      {buildLog.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  )}
                </div>
              )}

              {buildStatus === 'ready' && (
                <div className="space-y-2">
                  <p className="text-sm text-green-700 font-medium">✅ Compilación exitosa</p>
                  <Button onClick={() => {
                    const latest = firmwareList.find(b => b.target === deviceType && b.status === 'ready')
                    if (latest) selectBuildAndContinue(latest)
                  }} className="w-full">
                    Usar este firmware →
                  </Button>
                </div>
              )}

              {buildStatus === 'error' && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">❌ Error. ¿Está PlatformIO/Arduino CLI instalado?</p>
                  <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-red-400 max-h-48 overflow-y-auto">
                    {buildLog.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                  <Button onClick={handleCompile} variant="outline" className="w-full">Reintentar</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <button onClick={() => setStep(2)} className="text-sm text-muted-foreground hover:text-foreground">← Volver</button>
        </div>
      )}

      {/* ── Step 4: Flash ────────────────────────────────────────────────────── */}
      {step === 4 && createdDevice && selectedBuild && (
        <div className="space-y-4">
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="py-3 text-sm text-blue-800 space-y-1">
              <p className="font-semibold">Qué va a pasar:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-700 text-xs">
                <li>Conectás el ESP32 por USB y elegís el puerto</li>
                <li>El sistema escribe el firmware en el chip</li>
                <li>El ESP32 recibe su configuración automáticamente por serial</li>
                <li>El dispositivo queda listo — sin tocar nada más</li>
              </ol>
              <p className="text-xs text-blue-500 mt-1">Requiere Chrome o Edge (Web Serial API).</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Resumen</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1.5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="text-muted-foreground">Dispositivo:</span> <strong>{createdDevice.name}</strong></div>
                <div><span className="text-muted-foreground">Tipo:</span> <Badge variant="outline" className="text-xs">{createdDevice.device_type}</Badge></div>
                <div><span className="text-muted-foreground">Firmware:</span> v{selectedBuild.version}</div>
                <div><span className="text-muted-foreground">Device ID:</span> <code className="text-xs bg-gray-100 px-1 rounded">{createdDevice.device_id}</code></div>
                <div><span className="text-muted-foreground">LoRa:</span> {lora.freq_mhz} MHz · SF{lora.sf || 7} · {lora.tx_dbm} dBm</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Flash</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {flashStatus !== 'idle' && (
                <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
                  flashStatus === 'done'  ? 'bg-green-100 text-green-700' :
                  flashStatus === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'
                }`}>
                  {{ connecting: '🔌 Conectando al ESP32…', downloading: '⬇️ Descargando firmware…',
                     flashing: '⚡ Escribiendo firmware en el chip…', provisioning: '📡 Enviando configuración…',
                     done: '✅ ¡Listo! El ESP32 está configurado y operativo.', error: '❌ Error — revisá los logs', idle: '' }[flashStatus]}
                </div>
              )}

              {(flashStatus === 'flashing' || flashStatus === 'done') && (
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${flashProgress}%` }} />
                </div>
              )}

              {flashStatus === 'done' ? (
                <Button onClick={() => router.push(`/devices/${createdDevice.id}`)} className="w-full">
                  Ver dispositivo →
                </Button>
              ) : (
                <Button onClick={handleFlash}
                  disabled={['connecting', 'downloading', 'flashing', 'provisioning'].includes(flashStatus)}
                  className="w-full">
                  {['connecting', 'downloading', 'flashing', 'provisioning'].includes(flashStatus)
                    ? 'Procesando…' : '⚡ Conectar y flashear'}
                </Button>
              )}

              {flashLogs.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-green-400 max-h-64 overflow-y-auto">
                  {flashLogs.map((line, i) => <div key={i}>{line}</div>)}
                  <div ref={logsEndRef} />
                </div>
              )}
            </CardContent>
          </Card>

          {flashStatus !== 'done' && (
            <button onClick={() => setStep(3)} className="text-sm text-muted-foreground hover:text-foreground">← Volver</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Serial provisioning helper ──────────────────────────────────────────────────

async function sendProvisioningConfig(
  port: SerialPort,
  config: Record<string, unknown>,
  log: (msg: string) => void,
): Promise<boolean> {
  const decoder = new TextDecoderStream()
  const decoderDone = port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>)
  const reader = decoder.readable.getReader()
  try {
    let buffer = ''
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 500))
      const result = await Promise.race([reader.read(), timeout])
      if (result !== null) {
        const { value, done } = result as ReadableStreamReadResult<string>
        if (done) break
        buffer += value ?? ''
        if (buffer.includes('PROV_READY')) {
          log('ESP32 en modo provisioning. Enviando config…')
          const writer = port.writable!.getWriter()
          await writer.write(new TextEncoder().encode(JSON.stringify(config) + '\n'))
          writer.releaseLock()
          const okDeadline = Date.now() + 10000
          buffer = ''
          while (Date.now() < okDeadline) {
            const t2 = new Promise<null>((r) => setTimeout(() => r(null), 500))
            const res2 = await Promise.race([reader.read(), t2])
            if (res2 !== null) {
              const { value: v2, done: d2 } = res2 as ReadableStreamReadResult<string>
              if (d2) break
              buffer += v2 ?? ''
              if (buffer.includes('PROV_OK')) return true
            }
          }
          return false
        }
      }
    }
    return false
  } finally {
    reader.cancel()
    await decoderDone.catch(() => {})
  }
}
