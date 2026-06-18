'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getDevice } from '@/lib/devices'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface FirmwareBuild {
  id: number
  version: string
  target: 'emisor' | 'receptor'
  notes: string
  compiled_at: string
  status: string
  flash_offset?: number  // 0x0 = merged binary, 0x10000 = app only
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

  const qc = useQueryClient()

  const logFlash = useMutation({
    mutationFn: (success: boolean) =>
      api.post(`/api/devices/${id}/flash/`, {
        firmware: selectedFirmware?.id,
        method: 'usb_serial',
        success,
      }),
  })

  const [buildVersion, setBuildVersion] = useState('1.0.0')
  const [buildId, setBuildId] = useState<number | null>(null)
  const [buildStatus, setBuildStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [buildLog, setBuildLog] = useState<string>('')
  const buildLogRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPolling(), [])

  async function startBuild() {
    setBuildLog('')
    setBuildStatus('building')
    try {
      const { data } = await api.post(`/api/devices/${id}/build/`, { version: buildVersion })
      const bid: number = data.build_id
      setBuildId(bid)

      pollRef.current = setInterval(async () => {
        try {
          const { data: s } = await api.get(`/api/firmware/${bid}/status/`)
          setBuildLog(s.build_log ?? '')
          if (s.status !== 'building') {
            stopPolling()
            setBuildStatus(s.status)
            if (s.status === 'ready') {
              qc.invalidateQueries({ queryKey: ['firmware'] })
              toast.success('Firmware compilado correctamente')
            } else {
              toast.error('La compilación falló — revisá el log')
            }
          }
        } catch { stopPolling(); setBuildStatus('error') }
      }, 2000)
    } catch {
      setBuildStatus('error')
      toast.error('No se pudo iniciar la compilación')
    }
  }

  useEffect(() => {
    buildLogRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [buildLog])

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
        fileArray: [{ data: firmwareBinary, address: selectedFirmware.flash_offset ?? 0x0 }],
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

  const compatibleFirmware = firmwareList.filter((f) => !device || f.target === device.device_type)
  const otherFirmware = firmwareList.filter((f) => device && f.target !== device.device_type)

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
            <li>Seleccionás (o compilás) la versión de firmware a instalar</li>
            <li>Si no tenés un .bin, compilás desde el código fuente del servidor</li>
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
          <CardContent className="text-sm space-y-3">
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
              <div className="space-y-2">
                <div><span className="text-muted-foreground">WiFi:</span> <strong>{String(device.config?.wifi_ssid ?? '—')}</strong></div>
                <div>
                  <span className="text-muted-foreground">Token del dispositivo:</span>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all flex-1">{device.provisioning_token}</code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(device.provisioning_token); toast.success('Token copiado') }}
                      className="flex-shrink-0 text-xs border rounded px-2 py-1 hover:bg-gray-50"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Descarga secrets.h para usar con PlatformIO */}
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">
                ¿Usas PlatformIO? Descargá el <code className="bg-gray-100 px-0.5 rounded">secrets.h</code> y copialo a <code className="bg-gray-100 px-0.5 rounded">src/{device.device_type}/secrets.h</code>
              </p>
              <DownloadSecretsButton deviceId={device.id} />
            </div>

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
          {compatibleFirmware.length === 0 && otherFirmware.length === 0 ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>No hay builds disponibles para <strong>{device?.device_type ?? 'este tipo'}</strong>.</p>
              <p className="text-xs">Compilá uno en el paso 2 de abajo.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {compatibleFirmware.map((fw) => (
                <FirmwareRow key={fw.id} fw={fw} selected={selectedFirmware?.id === fw.id} onSelect={setSelectedFirmware} />
              ))}
              {compatibleFirmware.length === 0 && otherFirmware.length > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No hay builds de <strong>{device?.device_type}</strong>. Compilá uno en el paso 2, o usá uno de otro tipo bajo tu responsabilidad.
                </p>
              )}
              {otherFirmware.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
                    Builds de otro tipo ({otherFirmware.length}) — no recomendado
                  </summary>
                  <div className="space-y-1 mt-2">
                    {otherFirmware.map((fw) => (
                      <FirmwareRow key={fw.id} fw={fw} selected={selectedFirmware?.id === fw.id} onSelect={setSelectedFirmware} warn />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compilar desde fuente */}
      <Card>
        <CardHeader><CardTitle className="text-base">2 — Compilar firmware (opcional)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Si no tenés un <code className="bg-gray-100 px-0.5 rounded">.bin</code> disponible, compilá el firmware directamente desde el código fuente del servidor.
          </p>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="build-version" className="text-xs">Versión</Label>
              <Input
                id="build-version"
                value={buildVersion}
                onChange={e => setBuildVersion(e.target.value)}
                className="w-28 h-8 text-sm"
                disabled={buildStatus === 'building'}
              />
            </div>
            <Button
              variant="outline"
              onClick={startBuild}
              disabled={buildStatus === 'building'}
              className="h-8 text-sm"
            >
              {buildStatus === 'building' ? 'Compilando…' : '⚙ Compilar'}
            </Button>
            {buildStatus === 'ready' && buildId && (
              <span className="text-xs text-green-600 font-medium">✅ Listo — aparece en la lista de arriba</span>
            )}
            {buildStatus === 'error' && (
              <span className="text-xs text-red-600 font-medium">❌ Error de compilación</span>
            )}
          </div>

          {buildLog && (
            <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs text-green-400 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {buildLog}
              <div ref={buildLogRef} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flash */}
      <Card>
        <CardHeader><CardTitle className="text-base">3 — Conectar y flashear</CardTitle></CardHeader>
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
      {/* ── Serial Monitor ── */}
      <SerialMonitor />
    </div>
  )
}

// ──────────────────────────────────────────────────
// Monitor Serial integrado (Web Serial API)
// ──────────────────────────────────────────────────
const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 921600]

function SerialMonitor() {
  const [connected, setConnected]   = useState(false)
  const [baud, setBaud]             = useState(115200)
  const [lines, setLines]           = useState<{ text: string; ts: string }[]>([])
  const [input, setInput]           = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const portRef    = useRef<SerialPort | null>(null)
  const readerRef  = useRef<ReadableStreamDefaultReader | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoscroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoscroll])

  const addLine = useCallback((text: string) => {
    const ts = new Date().toLocaleTimeString('es-AR', { hour12: false })
    setLines(prev => {
      const next = [...prev, { text, ts }]
      return next.length > 1000 ? next.slice(-1000) : next
    })
  }, [])

  async function connect() {
    if (!('serial' in navigator)) { toast.error('Web Serial no disponible. Usá Chrome o Edge.'); return }
    try {
      const port = await (navigator as Navigator & { serial: { requestPort(): Promise<SerialPort> } }).serial.requestPort()
      await port.open({ baudRate: baud })
      portRef.current = port
      setConnected(true)
      setLines([])
      addLine(`── Conectado @ ${baud} baud ──`)
      readLoop(port)
    } catch (e) {
      if ((e as Error).name !== 'NotSelectedError') toast.error('No se pudo abrir el puerto')
    }
  }

  async function readLoop(port: SerialPort) {
    const decoder = new TextDecoderStream()
    port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {})
    const reader = decoder.readable.getReader()
    readerRef.current = reader
    let buf = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        for (const line of parts) {
          const trimmed = line.replace(/\r$/, '')
          if (trimmed) addLine(trimmed)
        }
      }
    } catch { /* port closed */ } finally {
      reader.releaseLock()
      setConnected(false)
      addLine('── Desconectado ──')
    }
  }

  async function disconnect() {
    try {
      readerRef.current?.cancel()
      await portRef.current?.close()
    } catch { /* ignore */ }
    portRef.current = null
    setConnected(false)
  }

  async function sendLine() {
    if (!input.trim() || !portRef.current?.writable) return
    const writer = portRef.current.writable.getWriter()
    await writer.write(new TextEncoder().encode(input + '\n'))
    writer.releaseLock()
    addLine(`> ${input}`)
    setInput('')
    inputRef.current?.focus()
  }

  function lineColor(text: string) {
    if (text.startsWith('──'))         return 'text-gray-500'
    if (text.startsWith('> '))         return 'text-yellow-400'
    if (text.includes('ERROR') || text.includes('❌')) return 'text-red-400'
    if (text.includes('OK') || text.includes('✅'))    return 'text-green-400'
    if (text.startsWith('[POST]'))     return 'text-blue-400'
    if (text.startsWith('[RELAY]'))    return 'text-purple-400'
    if (text.startsWith('[CMD]'))      return 'text-yellow-300'
    if (text.startsWith('[GPS]'))      return 'text-cyan-400'
    if (text.startsWith('[LORA]') || text.startsWith('[ LORA ]')) return 'text-orange-400'
    return 'text-green-300'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            Monitor Serial
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <input type="checkbox" checked={autoscroll} onChange={e => setAutoscroll(e.target.checked)} className="w-3 h-3" />
              Auto-scroll
            </label>
            <button onClick={() => setLines([])} className="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-0.5">
              Limpiar
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={baud}
            onChange={e => setBaud(Number(e.target.value))}
            disabled={connected}
            className="border rounded px-2 py-1.5 text-sm disabled:opacity-50"
          >
            {BAUD_RATES.map(b => <option key={b} value={b}>{b} baud</option>)}
          </select>
          {connected ? (
            <Button variant="outline" onClick={disconnect} className="text-red-600 border-red-300 hover:bg-red-50">
              ⏹ Desconectar
            </Button>
          ) : (
            <Button variant="outline" onClick={connect}>
              ▶ Conectar puerto
            </Button>
          )}
        </div>

        {/* Terminal */}
        <div className="bg-gray-950 rounded-lg p-3 font-mono text-xs h-72 overflow-y-auto">
          {lines.length === 0 ? (
            <span className="text-gray-600">Conectá el ESP32 y presioná "Conectar puerto"…</span>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`flex gap-2 leading-5 ${lineColor(l.text)}`}>
                <span className="text-gray-600 shrink-0 select-none">{l.ts}</span>
                <span className="break-all">{l.text}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input de envío */}
        {connected && (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendLine()}
              placeholder='Enviar texto al ESP32 (Enter para enviar)…'
              className="flex-1 border rounded px-3 py-1.5 text-sm font-mono bg-gray-950 text-green-300 border-gray-700 focus:outline-none focus:border-green-600"
            />
            <Button variant="outline" onClick={sendLine} className="text-xs">Enviar</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────
// Descarga secrets.h para uso con PlatformIO
// ──────────────────────────────────────────────────
function FirmwareRow({
  fw,
  selected,
  onSelect,
  warn = false,
}: {
  fw: FirmwareBuild
  selected: boolean
  onSelect: (fw: FirmwareBuild) => void
  warn?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(fw)}
      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
        selected
          ? 'border-green-500 bg-green-50'
          : warn
          ? 'border-amber-200 hover:border-amber-400 hover:bg-amber-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">v{fw.version}</span>
        <div className="flex items-center gap-1.5">
          {warn && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">⚠ tipo incorrecto</Badge>}
          <Badge variant="outline" className="text-xs">{fw.target}</Badge>
        </div>
      </div>
      {fw.notes && <p className="text-xs text-muted-foreground mt-0.5">{fw.notes}</p>}
    </button>
  )
}

function DownloadSecretsButton({ deviceId }: { deviceId: number }) {
  async function download() {
    const res = await api.get(`/api/devices/${deviceId}/secrets/`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([res.data as BlobPart]))
    const a = document.createElement('a'); a.href = url; a.download = 'secrets.h'; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex items-center gap-1.5 text-green-700 border border-green-300 rounded px-3 py-1.5 hover:bg-green-50 transition-colors text-xs font-medium"
    >
      ↓ Descargar secrets.h
    </button>
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
