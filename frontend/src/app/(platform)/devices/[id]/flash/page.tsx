'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getDevice } from '@/lib/devices'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface FirmwareBuild {
  id: number
  version: string
  target: 'emisor' | 'receptor'
  notes: string
  compiled_at: string
}

type FlashStatus = 'idle' | 'connecting' | 'downloading' | 'flashing' | 'provisioning' | 'done' | 'error'

const STATUS_LABEL: Record<FlashStatus, string> = {
  idle: 'Listo para flashear',
  connecting: 'Conectando al ESP32…',
  downloading: 'Descargando firmware…',
  flashing: 'Escribiendo firmware en el ESP32…',
  provisioning: 'Enviando configuración al ESP32…',
  done: '¡Listo! El ESP32 está configurado y arrancando.',
  error: 'Error — revisa los logs',
}

const STATUS_COLOR: Record<FlashStatus, string> = {
  idle: 'bg-gray-100 text-gray-700',
  connecting: 'bg-yellow-100 text-yellow-800',
  downloading: 'bg-blue-100 text-blue-800',
  flashing: 'bg-orange-100 text-orange-800',
  provisioning: 'bg-purple-100 text-purple-800',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
}

export default function FlashPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [selectedFirmware, setSelectedFirmware] = useState<FirmwareBuild | null>(null)
  const [status, setStatus] = useState<FlashStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)

  const { data: device } = useQuery({
    queryKey: ['device', id],
    queryFn: () => getDevice(Number(id)),
  })

  const { data: firmwareList = [] } = useQuery<FirmwareBuild[]>({
    queryKey: ['firmware'],
    queryFn: async () => {
      const { data } = await api.get('/api/firmware/')
      return data
    },
  })

  const logFlash = useMutation({
    mutationFn: (success: boolean) =>
      api.post(`/api/devices/${id}/flash/`, {
        firmware: selectedFirmware?.id,
        method: 'usb_serial',
        success,
      }),
  })

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function addLog(msg: string) {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  async function handleFlash() {
    if (!selectedFirmware) {
      toast.error('Selecciona una versión de firmware primero')
      return
    }
    if (!('serial' in navigator)) {
      toast.error('Web Serial no está soportado. Usa Chrome o Edge.')
      return
    }

    setLogs([])
    setProgress(0)
    setStatus('connecting')
    addLog('Solicitando acceso al puerto serial…')

    let port: SerialPort | null = null

    try {
      // ── 1. Obtener config de provisioning del backend ──────────────────────
      const { data: provInfo } = await api.get(`/api/devices/${id}/provision/`)
      const provPayload: Record<string, unknown> = provInfo.provisioning_payload

      // ── 2. Conectar puerto serial ─────────────────────────────────────────
      port = await (navigator as Navigator & { serial: { requestPort: () => Promise<SerialPort> } }).serial.requestPort()
      addLog('Puerto seleccionado.')

      // ── 3. Descargar firmware ─────────────────────────────────────────────
      setStatus('downloading')
      addLog(`Descargando firmware v${selectedFirmware.version}…`)
      const response = await api.get(`/api/firmware/${selectedFirmware.id}/download/`, {
        responseType: 'arraybuffer',
      })
      const firmwareBinary = new Uint8Array(response.data as ArrayBuffer)
      addLog(`Firmware: ${(firmwareBinary.length / 1024).toFixed(1)} KB`)

      // ── 4. Flash con esptool-js ───────────────────────────────────────────
      setStatus('flashing')
      const { ESPLoader, Transport } = await import('esptool-js')
      const transport = new Transport(port)
      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal: {
          clean() {},
          writeLine(data: string) { addLog(data) },
          write(data: string) { addLog(data) },
        },
        enableTracing: false,
      })

      addLog('Conectando al chip…')
      const chip = await loader.main()
      addLog(`Chip: ${chip}`)

      addLog('Borrando flash…')
      await loader.eraseFlash()

      addLog('Escribiendo firmware…')
      await loader.writeFlash({
        fileArray: [{ data: firmwareBinary, address: 0x1000 }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex: number, written: number, total: number) => {
          const pct = Math.round((written / total) * 100)
          setProgress(pct)
          if (pct % 25 === 0) addLog(`Progreso: ${pct}%`)
        },
      })

      addLog('Firmware escrito. Reiniciando ESP32…')
      await loader.after('hard_reset')
      await transport.disconnect()

      // ── 5. Provisioning por serial ────────────────────────────────────────
      setStatus('provisioning')
      addLog('ESP32 arrancando… esperando modo provisioning (PROV_READY)…')
      addLog('Si el firmware ya tiene config en NVS esto se omite automáticamente.')

      // Pequeña espera para que el ESP32 arranque
      await new Promise((r) => setTimeout(r, 2000))

      // Abrir puerto en modo serial normal
      await port.open({ baudRate: 115200 })

      const provSent = await sendProvisioningConfig(port, provPayload, addLog)

      await port.close()

      if (provSent) {
        addLog('PROV_OK recibido. El ESP32 se está configurando y reiniciando.')
      } else {
        addLog('Sin respuesta PROV_READY — firmware usa config existente (NVS o secrets.h). OK.')
      }

      // ── 6. Registrar flash exitoso ─────────────────────────────────────────
      setStatus('done')
      setProgress(100)
      addLog('✅ Proceso completado.')
      logFlash.mutate(true)
      toast.success('ESP32 flasheado y configurado correctamente')

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ Error: ${msg}`)
      setStatus('error')
      logFlash.mutate(false)
      toast.error('Error — revisa los logs')
      if (port) {
        try { if (port.readable || port.writable) await port.close() } catch { /* ignore */ }
      }
    }
  }

  const compatibleFirmware = firmwareList.filter(
    (f) => !device || f.target === device.device_type,
  )

  const isRunning = ['connecting', 'downloading', 'flashing', 'provisioning'].includes(status)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => router.back()}
          className="text-sm text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1">
          ← Volver
        </button>
        <h1 className="text-2xl font-bold">Flash de Firmware</h1>
        {device && (
          <p className="text-muted-foreground text-sm mt-1">
            {device.name} · <code className="text-xs bg-gray-100 px-1 rounded">{device.device_id}</code>
            · <Badge variant="outline" className="text-xs">{device.device_type}</Badge>
          </p>
        )}
      </div>

      {/* Pasos explicados */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-4 text-sm text-blue-800 space-y-2">
          <p className="font-semibold">Qué va a pasar:</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700">
            <li>Seleccionás la versión de firmware a instalar</li>
            <li>Conectás el ESP32 por USB y elegís el puerto</li>
            <li>El sistema escribe el firmware en el chip automáticamente</li>
            <li>El ESP32 arranca y <strong>recibe su configuración automáticamente</strong> por serial</li>
            <li>El dispositivo queda listo — sin tocar archivos ni PlatformIO</li>
          </ol>
          <p className="text-xs mt-2 text-blue-600">
            Requiere <strong>Chrome</strong> o <strong>Edge</strong> (Web Serial API).
            Conectar ESP32 por USB antes de comenzar.
          </p>
        </CardContent>
      </Card>

      {/* Configuración actual */}
      {device && (
        <Card>
          <CardHeader><CardTitle className="text-base">Config que se enviará al dispositivo</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            {device.device_type === 'emisor' ? (
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Device ID:</span> <code className="bg-gray-100 px-1 rounded text-xs">{device.device_id}</code></div>
                <div><span className="text-muted-foreground">Sleep:</span> {String(device.config?.sleep_minutes ?? 10)} min</div>
                {device.assigned_gateway_name && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Receptor:</span> {device.assigned_gateway_name}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">WiFi:</span> {String(device.config?.wifi_ssid ?? '—')}</div>
                <div><span className="text-muted-foreground">Token:</span> <code className="text-xs bg-gray-100 px-1 rounded">{device.provisioning_token.slice(0, 12)}…</code></div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Para cambiar estos valores editá el dispositivo y volvé a flashear.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Selector de firmware */}
      <Card>
        <CardHeader><CardTitle className="text-base">1 — Seleccioná la versión</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {compatibleFirmware.length === 0 ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>No hay builds disponibles para <strong>{device?.device_type ?? 'este tipo'}</strong>.</p>
              <button onClick={() => router.push('/firmware')}
                className="text-green-600 underline text-sm">
                Subir un firmware →
              </button>
            </div>
          ) : (
            compatibleFirmware.map((fw) => (
              <button key={fw.id} type="button" onClick={() => setSelectedFirmware(fw)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  selectedFirmware?.id === fw.id
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">v{fw.version}</span>
                  <Badge variant="outline" className="text-xs">{fw.target}</Badge>
                </div>
                {fw.notes && <p className="text-xs text-muted-foreground mt-0.5">{fw.notes}</p>}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Flash */}
      <Card>
        <CardHeader><CardTitle className="text-base">2 — Conectar y flashear</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </div>

          {(status === 'flashing' || status === 'provisioning' || status === 'done') && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }} />
            </div>
          )}

          <Button onClick={handleFlash} disabled={isRunning} className="w-full">
            {isRunning ? 'Procesando…' : status === 'done' ? '⚡ Flashear de nuevo' : '⚡ Conectar y flashear'}
          </Button>

          {logs.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-green-400 max-h-64 overflow-y-auto">
              {logs.map((line, i) => <div key={i}>{line}</div>)}
              <div ref={logsEndRef} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ──────────────────────────────────────────────────
// Envía config JSON al ESP32 en modo provisioning
// Retorna true si recibió PROV_OK, false si timeout
// ──────────────────────────────────────────────────
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
    const deadline = Date.now() + 15000 // 15s para detectar PROV_READY

    // Esperar PROV_READY
    while (Date.now() < deadline) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 500))
      const read = reader.read().then((r) => r)
      const result = await Promise.race([read, timeout])

      if (result !== null) {
        const { value, done } = result as ReadableStreamReadResult<string>
        if (done) break
        buffer += value ?? ''
        if (buffer.includes('PROV_READY')) {
          log('ESP32 en modo provisioning. Enviando configuración…')

          const jsonLine = JSON.stringify(config) + '\n'
          const writer = port.writable!.getWriter()
          await writer.write(new TextEncoder().encode(jsonLine))
          writer.releaseLock()

          // Esperar PROV_OK (10s)
          const okDeadline = Date.now() + 10000
          buffer = ''
          while (Date.now() < okDeadline) {
            const t2 = new Promise<null>((r) => setTimeout(() => r(null), 500))
            const r2 = reader.read().then((r) => r)
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
    return false // No apareció PROV_READY — firmware ya tiene config
  } finally {
    reader.cancel()
    await decoderDone.catch(() => {})
  }
}
