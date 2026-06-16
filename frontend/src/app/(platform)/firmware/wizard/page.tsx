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
  binary?: string | null
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

const SENSOR_OPTIONS = [
  { type: 'SHTC3', label: 'SHTC3', desc: 'Temp/Humedad Ambiente', icon: '🌡️' },
  { type: 'DS18B20', label: 'DS18B20', desc: 'Temperatura Sonda', icon: '🔌' },
  { type: 'GPS', label: 'GPS', desc: 'Posición GPS', icon: '📍' },
  { type: 'BAT', label: 'BAT', desc: 'Batería', icon: '🔋' },
]

// ─── Step indicators ──────────────────────────────────────────────────────────

function Steps({ current }: { current: WizardStep }) {
  const steps = ['Tipo', 'Configurar', 'Firmware', 'Flash']
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = (i + 1) as WizardStep
        const done = n < current
        const active = n === current
        return (
          <div key={n} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active ? 'bg-green-600 text-white' :
              done ? 'bg-green-100 text-green-700' :
              'bg-gray-100 text-gray-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                active ? 'bg-white text-green-600' :
                done ? 'bg-green-500 text-white' :
                'bg-gray-300 text-gray-500'
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FirmwareWizardPage() {
  const router = useRouter()
  const qc = useQueryClient()

  // Wizard state
  const [step, setStep] = useState<WizardStep>(1)
  const [deviceType, setDeviceType] = useState<DeviceType>('emisor')
  const [selectedSensors, setSelectedSensors] = useState(['SHTC3', 'DS18B20', 'BAT'])
  const [assignedGateway, setAssignedGateway] = useState('')
  const [createdDevice, setCreatedDevice] = useState<CreatedDevice | null>(null)
  const [selectedBuild, setSelectedBuild] = useState<FirmwareBuild | null>(null)
  const [buildingId, setBuildingId] = useState<number | null>(null)
  const [buildLog, setBuildLog] = useState('')
  const [buildStatus, setBuildStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')

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
    queryFn: async () => {
      const { data } = await api.get('/api/firmware/')
      return data
    },
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

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createDeviceMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (device) => {
      setCreatedDevice(device as unknown as CreatedDevice)
      qc.invalidateQueries({ queryKey: ['devices'] })
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

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleStep2Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const config: Record<string, unknown> = {
      sleep_minutes: Number(form.get('sleep_minutes') ?? 10),
    }
    if (deviceType === 'receptor') {
      config.wifi_ssid = form.get('wifi_ssid') as string
      config.wifi_pass = form.get('wifi_pass') as string
    }
    createDeviceMutation.mutate({
      device_id: form.get('device_id') as string,
      name: form.get('name') as string,
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
      const { data } = await api.post('/api/firmware/build/', {
        target: deviceType,
        version: `auto-${createdDevice.device_id}-${Date.now()}`.slice(0, 30),
        notes: `Auto-compilado para ${createdDevice.name}`,
      })
      setBuildingId(data.id)
    } catch {
      setBuildStatus('error')
      toast.error('No se pudo iniciar la compilación. ¿Está PlatformIO instalado?')
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
        transport,
        baudrate: 115200,
        terminal: {
          clean() {},
          writeLine(d: string) { addLog(d) },
          write(d: string) { addLog(d) },
        },
        enableTracing: false,
      })

      addLog('Conectando al chip…')
      const chip = await loader.main()
      addLog(`Chip detectado: ${chip}`)
      addLog('Borrando flash…')
      await loader.eraseFlash()
      addLog('Escribiendo firmware…')
      await loader.writeFlash({
        fileArray: [{ data: binary, address: 0x1000 }],
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
      else addLog('Sin PROV_READY — firmware usa config existente. OK.')

      setFlashStatus('done')
      setFlashProgress(100)
      addLog('✅ ¡Listo! El nodo está operativo.')

      await api.post(`/api/devices/${createdDevice.id}/flash/`, {
        firmware: selectedBuild.id,
        method: 'usb_serial',
        success: true,
      })
      toast.success('¡Nodo configurado correctamente!')

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ Error: ${msg}`)
      setFlashStatus('error')
      if (createdDevice && selectedBuild) {
        await api.post(`/api/devices/${createdDevice.id}/flash/`, {
          firmware: selectedBuild.id,
          method: 'usb_serial',
          success: false,
        }).catch(() => {})
      }
      if (port) {
        try { if (port.readable || port.writable) await port.close() } catch { /* ignore */ }
      }
    }
  }

  const compatibleBuilds = firmwareList.filter(
    (b) => b.target === deviceType && b.status === 'ready' && b.binary,
  )

  // ── Render ──────────────────────────────────────────────────────────────────

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

      {/* ── Step 1: Tipo ── */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">¿Qué tipo de nodo vas a crear?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {(['emisor', 'receptor'] as DeviceType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setDeviceType(t)}
                  className={`p-5 rounded-xl border-2 text-left transition-all ${
                    deviceType === t
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="text-3xl mb-2">{t === 'emisor' ? '📡' : '🔌'}</div>
                  <div className="font-semibold text-sm capitalize mb-1">{t}</div>
                  <div className="text-xs text-muted-foreground">
                    {t === 'emisor'
                      ? 'Lee sensores y envía datos por LoRa al receptor más cercano.'
                      : 'Recibe datos LoRa y los reenvía al servidor por WiFi.'}
                  </div>
                </button>
              ))}
            </div>
            <Button onClick={() => setStep(2)} className="w-full">
              Continuar →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Configurar ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Configurar {deviceType === 'emisor' ? '📡 Emisor' : '🔌 Receptor'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep2Submit} className="space-y-5">
              <div className="space-y-1">
                <Label htmlFor="name">Nombre del nodo</Label>
                <Input id="name" name="name" placeholder={deviceType === 'emisor' ? 'Parcela Norte — Suelo' : 'Gateway Invernadero A'} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="device_id">
                  ID único <span className="text-xs text-muted-foreground">(se usa en el firmware)</span>
                </Label>
                <Input id="device_id" name="device_id" placeholder={deviceType === 'emisor' ? 'nodo-norte-001' : 'gateway-inv-a'} required />
              </div>

              {deviceType === 'emisor' && (
                <>
                  <div className="space-y-2">
                    <Label>Sensores instalados</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {SENSOR_OPTIONS.map(({ type, label, desc, icon }) => {
                        const active = selectedSensors.includes(type)
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() =>
                              setSelectedSensors((prev) =>
                                prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                              )
                            }
                            className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                              active ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
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

                  <div className="space-y-1">
                    <Label htmlFor="sleep_minutes">Intervalo de envío (minutos)</Label>
                    <Input id="sleep_minutes" name="sleep_minutes" type="number" min={1} max={60} defaultValue={10} required />
                    <p className="text-xs text-muted-foreground">El nodo entra en deep sleep entre lecturas para ahorrar batería.</p>
                  </div>

                  <div className="space-y-1">
                    <Label>Receptor asignado</Label>
                    {receptors.length === 0 ? (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        No hay receptores. Podés asignar uno más tarde desde la topología.
                      </p>
                    ) : (
                      <select
                        value={assignedGateway}
                        onChange={(e) => setAssignedGateway(e.target.value)}
                        className="w-full border rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">Sin asignar</option>
                        {receptors.map((r) => (
                          <option key={r.id} value={r.id}>{r.name} ({r.device_id})</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}

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
                  <Input type="hidden" name="sleep_minutes" value="10" />
                </div>
              )}

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

      {/* ── Step 3: Firmware ── */}
      {step === 3 && createdDevice && (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="py-3 text-sm text-green-800">
              ✅ Dispositivo <strong>{createdDevice.name}</strong> registrado correctamente.
            </CardContent>
          </Card>

          {/* Opción A: builds existentes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usar firmware existente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {compatibleBuilds.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay builds de <strong>{deviceType}</strong> disponibles todavía.</p>
              ) : (
                compatibleBuilds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => selectBuildAndContinue(b)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedBuild?.id === b.id
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">v{b.version}</span>
                      <Badge variant="outline" className="text-xs">{b.target}</Badge>
                    </div>
                    {b.notes && <p className="text-xs text-muted-foreground mt-0.5">{b.notes}</p>}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Opción B: compilar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compilar nuevo firmware</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Genera un <code className="text-xs bg-gray-100 px-1 rounded">.bin</code> fresco con PlatformIO instalado en el servidor.
                Tarda ~60 segundos.
              </p>

              {buildStatus === 'idle' && (
                <Button onClick={handleCompile} variant="outline" className="w-full">
                  ⚡ Compilar ahora
                </Button>
              )}

              {buildStatus === 'building' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Compilando con PlatformIO…
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
                  <Button
                    onClick={() => {
                      const latest = firmwareList.find((b) => b.target === deviceType && b.status === 'ready')
                      if (latest) selectBuildAndContinue(latest)
                    }}
                    className="w-full"
                  >
                    Usar este firmware y continuar →
                  </Button>
                </div>
              )}

              {buildStatus === 'error' && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">❌ Error en la compilación. ¿Está PlatformIO instalado?</p>
                  <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-red-400 max-h-48 overflow-y-auto">
                    {buildLog.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                  <Button onClick={handleCompile} variant="outline" className="w-full">Reintentar</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <button onClick={() => setStep(2)} className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver
          </button>
        </div>
      )}

      {/* ── Step 4: Flash ── */}
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Flash</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {flashStatus !== 'idle' && (
                <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
                  flashStatus === 'done' ? 'bg-green-100 text-green-700' :
                  flashStatus === 'error' ? 'bg-red-100 text-red-700' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {{
                    connecting: '🔌 Conectando al ESP32…',
                    downloading: '⬇️ Descargando firmware…',
                    flashing: '⚡ Escribiendo firmware en el chip…',
                    provisioning: '📡 Enviando configuración…',
                    done: '✅ ¡Listo! El ESP32 está configurado y operativo.',
                    error: '❌ Error — revisá los logs',
                    idle: '',
                  }[flashStatus]}
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
                <Button
                  onClick={handleFlash}
                  disabled={['connecting', 'downloading', 'flashing', 'provisioning'].includes(flashStatus)}
                  className="w-full"
                >
                  {['connecting', 'downloading', 'flashing', 'provisioning'].includes(flashStatus)
                    ? 'Procesando…'
                    : '⚡ Conectar y flashear'}
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
            <button onClick={() => setStep(3)} className="text-sm text-muted-foreground hover:text-foreground">
              ← Volver
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Serial provisioning helper ─────────────────────────────────────────────────

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
      const read = reader.read()
      const result = await Promise.race([read, timeout])
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
            const r2 = reader.read()
            const res2 = await Promise.race([r2, t2])
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
