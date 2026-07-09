'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  updateDevice, deleteDevice, getReceptors,
  getDeviceCommands, createCommand, deleteCommand,
  type DeviceCommand, type CommandType,
} from '@/lib/devices'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmitterItem {
  id: number
  device_id: string
  name: string
  is_online: boolean
  last_seen: string | null
  sensors: { sensor_type: string }[]
  config: Record<string, unknown>
  last_rssi: number | null
  last_reading_at: string | null
  pending_commands: number
}

interface ReceptorItem {
  id: number
  device_id: string
  name: string
  is_online: boolean
  last_seen: string | null
  sensors: { sensor_type: string }[]
  config: Record<string, unknown>
  emitters: EmitterItem[]
  avg_rssi: number | null
}

interface TopologyData {
  receptors: ReceptorItem[]
  unassigned: EmitterItem[]
}

// ─── RSSI helpers ─────────────────────────────────────────────────────────────

function rssiQuality(rssi: number | null): { label: string; color: string; bars: number } {
  if (rssi === null) return { label: 'Sin datos', color: 'text-gray-400', bars: 0 }
  if (rssi >= -60) return { label: 'Excelente', color: 'text-green-600', bars: 4 }
  if (rssi >= -75) return { label: 'Buena', color: 'text-green-500', bars: 3 }
  if (rssi >= -90) return { label: 'Regular', color: 'text-amber-500', bars: 2 }
  return { label: 'Débil', color: 'text-red-500', bars: 1 }
}

function RssiBars({ rssi }: { rssi: number | null }) {
  const { bars, color } = rssiQuality(rssi)
  return (
    <span className="inline-flex items-end gap-0.5">
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={`inline-block w-1 rounded-sm ${b <= bars ? color.replace('text-', 'bg-') : 'bg-gray-200'}`}
          style={{ height: 4 + b * 3 }}
        />
      ))}
    </span>
  )
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function ReceptorNode({ data, selected }: NodeProps) {
  const d = data as unknown as ReceptorItem
  return (
    <div className={`bg-white border-2 rounded-2xl px-4 py-3 min-w-[210px] shadow-md transition-all ${
      selected ? 'border-blue-500 shadow-blue-200 shadow-lg' : 'border-blue-300 hover:border-blue-400'
    }`}>
      <Handle type="target" position={Position.Right} style={{ background: '#3b82f6', width: 10, height: 10 }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${d.is_online ? 'bg-green-400' : 'bg-gray-300'}`} />
        <span className="font-semibold text-sm text-gray-900 truncate">{d.name}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-blue-600 font-medium">🔌 Receptor</span>
        {d.avg_rssi !== null && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <RssiBars rssi={d.avg_rssi} />
            <span>{d.avg_rssi} dBm</span>
          </span>
        )}
      </div>
      {!!d.config?.wifi_ssid && (
        <p className="text-xs text-gray-400 truncate mt-1">📶 {String(d.config.wifi_ssid)}</p>
      )}
      <p className="text-xs text-gray-300 font-mono mt-1 truncate">{d.device_id}</p>
    </div>
  )
}

function EmitterNode({ data, selected }: NodeProps) {
  const d = data as unknown as EmitterItem & { unassigned?: boolean }
  return (
    <div className={`bg-white border-2 rounded-2xl px-4 py-3 min-w-[210px] shadow-md transition-all ${
      selected
        ? 'border-green-500 shadow-green-200 shadow-lg'
        : d.unassigned ? 'border-amber-300 hover:border-amber-400'
        : 'border-green-300 hover:border-green-400'
    }`}>
      <Handle type="source" position={Position.Left} style={{ background: '#16a34a', width: 10, height: 10 }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${d.is_online ? 'bg-green-400' : 'bg-gray-300'}`} />
        <span className="font-semibold text-sm text-gray-900 truncate">{d.name}</span>
        {(d.pending_commands ?? 0) > 0 && (
          <span className="ml-auto bg-amber-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
            {d.pending_commands}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${d.unassigned ? 'text-amber-600' : 'text-green-600'}`}>
          📡 {d.unassigned ? 'Sin receptor' : 'Emisor'}
        </span>
        {d.last_rssi !== null && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <RssiBars rssi={d.last_rssi} />
            <span>{d.last_rssi} dBm</span>
          </span>
        )}
      </div>
      {d.sensors.length > 0 && (
        <p className="text-xs text-gray-400 mt-1">{d.sensors.map((s) => s.sensor_type).join(' · ')}</p>
      )}
      <p className="text-xs text-gray-300 font-mono mt-1 truncate">{d.device_id}</p>
    </div>
  )
}

const nodeTypes = { receptor: ReceptorNode, emitter: EmitterNode }

// ─── Layout ───────────────────────────────────────────────────────────────────

function buildGraph(topology: TopologyData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let receptorY = 60
  let emitterY = 60

  for (const receptor of topology.receptors) {
    const rId = `r-${receptor.id}`
    nodes.push({ id: rId, type: 'receptor', position: { x: 60, y: receptorY }, data: receptor as unknown as Record<string, unknown> })
    for (const emitter of receptor.emitters) {
      const eId = `e-${emitter.id}`
      nodes.push({ id: eId, type: 'emitter', position: { x: 440, y: emitterY }, data: emitter as unknown as Record<string, unknown> })
      edges.push({ id: `edge-${emitter.id}`, source: eId, target: rId, animated: emitter.is_online, style: { stroke: '#16a34a', strokeWidth: 2 }, deletable: true })
      emitterY += 180
    }
    receptorY = Math.max(receptorY + 220, emitterY)
  }
  for (const emitter of topology.unassigned) {
    nodes.push({ id: `e-${emitter.id}`, type: 'emitter', position: { x: 440, y: emitterY }, data: { ...emitter, unassigned: true } as unknown as Record<string, unknown> })
    emitterY += 180
  }
  return { nodes, edges }
}

// ─── Shared panel shell ───────────────────────────────────────────────────────

function PanelShell({
  title, subtitle, accent, icon, onClose, children, footer,
}: {
  title: string; subtitle?: string; accent: string; icon: string
  onClose: () => void; children: React.ReactNode; footer?: React.ReactNode
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-88 bg-white border-l shadow-2xl flex flex-col" style={{ width: 360 }}>
        <div className={`px-5 py-4 border-b ${accent}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{icon}</span>
              <div>
                {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                <p className="font-semibold text-sm leading-tight truncate max-w-[230px]">{title}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-7 h-7 flex items-center justify-center">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t">{footer}</div>}
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      value={value} onChange={onChange} type={type} placeholder={placeholder}
      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      {...rest}
    />
  )
}

// ─── Receptor panel ───────────────────────────────────────────────────────────

function ReceptorPanel({ device, onClose }: { device: ReceptorItem; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(device.name)
  const [wifiSsid, setWifiSsid] = useState(String(device.config?.wifi_ssid ?? ''))
  const [wifiPass, setWifiPass] = useState(String(device.config?.wifi_pass ?? ''))
  const [loraFreq] = useState(String(device.config?.lora_freq ?? '915'))
  const [deleting, setDeleting] = useState(false)

  const lastSeen = device.last_seen
    ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true, locale: es })
    : null

  const save = useMutation({
    mutationFn: () => updateDevice(device.id, {
      name,
      config: { ...device.config, wifi_ssid: wifiSsid, wifi_pass: wifiPass },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topology'] }); toast.success('Cambios guardados'); onClose() },
    onError: () => toast.error('Error al guardar'),
  })

  const del = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topology'] }); qc.invalidateQueries({ queryKey: ['devices'] }); toast.success(`${device.name} eliminado`); onClose() },
    onError: () => toast.error('No se pudo eliminar'),
  })

  return (
    <PanelShell
      title={device.name} subtitle="Receptor / Gateway" icon="🔌" accent="bg-blue-50"
      onClose={onClose}
      footer={
        <div className="px-5 py-4 space-y-2">
          <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}
            className="w-full px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {save.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {!deleting ? (
            <button onClick={() => setDeleting(true)} className="w-full px-4 py-2.5 border border-red-200 text-red-500 rounded-xl text-sm hover:bg-red-50 transition-colors">
              🗑 Eliminar receptor
            </button>
          ) : (
            <div className="border border-red-300 rounded-xl p-3 space-y-2">
              <p className="text-xs text-red-600 text-center">Los emisores quedarán sin asignar. ¿Continuar?</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleting(false)} className="flex-1 px-3 py-2 text-xs border rounded-lg hover:bg-gray-50">Cancelar</button>
                <button onClick={() => del.mutate()} disabled={del.isPending}
                  className="flex-1 px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {del.isPending ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <div className="px-5 py-4 space-y-5">

        {/* Status row */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-xl p-3 text-center ${device.is_online ? 'bg-green-50' : 'bg-gray-50'}`}>
            <p className="text-lg">{device.is_online ? '🟢' : '⚫'}</p>
            <p className={`text-xs font-medium mt-0.5 ${device.is_online ? 'text-green-700' : 'text-gray-500'}`}>
              {device.is_online ? 'Online' : 'Offline'}
            </p>
          </div>
          <div className="rounded-xl p-3 text-center bg-blue-50">
            <p className="text-lg font-bold text-blue-700">{device.emitters.length}</p>
            <p className="text-xs text-blue-500 mt-0.5">Emisores</p>
          </div>
          <div className="rounded-xl p-3 text-center bg-gray-50">
            <p className="text-sm font-bold text-gray-700 leading-tight">{loraFreq}</p>
            <p className="text-xs text-gray-400 mt-0.5">MHz LoRa</p>
          </div>
        </div>

        {lastSeen && (
          <p className="text-xs text-gray-400 text-center">Último contacto {lastSeen}</p>
        )}

        {/* RSSI summary */}
        {device.emitters.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-medium text-gray-600 mb-2.5">Señal LoRa — emisores conectados</p>
            <div className="space-y-2">
              {device.emitters.map((e) => {
                const q = rssiQuality(e.last_rssi)
                return (
                  <div key={e.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${e.is_online ? 'bg-green-400' : 'bg-gray-300'}`} />
                      <span className="text-xs text-gray-700 truncate">{e.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <RssiBars rssi={e.last_rssi} />
                      {e.last_rssi !== null
                        ? <span className={`text-xs font-medium ${q.color}`}>{e.last_rssi} dBm</span>
                        : <span className="text-xs text-gray-400">—</span>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
            {device.avg_rssi !== null && (
              <div className="mt-2.5 pt-2.5 border-t border-gray-200 flex items-center justify-between">
                <span className="text-xs text-gray-500">Promedio</span>
                <span className={`text-xs font-semibold ${rssiQuality(device.avg_rssi).color}`}>
                  {device.avg_rssi} dBm — {rssiQuality(device.avg_rssi).label}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Edit fields */}
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Red WiFi (SSID)">
          <Input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} placeholder="Nombre de red" />
        </Field>
        <Field label="Contraseña WiFi">
          <Input type="password" value={wifiPass} onChange={(e) => setWifiPass(e.target.value)} placeholder="••••••••" />
        </Field>

        {/* Quick links */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Accesos rápidos</p>
          <a href={`/devices/${device.id}/flash`}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 transition-colors">
            <span>⚡ Flash firmware</span><span className="text-gray-400">→</span>
          </a>
          <a href={`/devices/${device.id}`}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 transition-colors">
            <span>📊 Ver telemetría</span><span className="text-gray-400">→</span>
          </a>
        </div>

        {/* Info note about relay */}
        <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-700 leading-relaxed">
          <strong>Relay de comandos:</strong> Tras cada POST de telemetría exitoso, el receptor consulta <code className="bg-blue-100 px-1 rounded">/api/relay/?token=…&emitter=&lt;id&gt;</code> y retransmite los comandos pendientes por LoRa. El emisor los recibe en su ventana de escucha de 7 segundos.
        </div>
      </div>
    </PanelShell>
  )
}

// ─── Emitter panel ────────────────────────────────────────────────────────────

const CMD_OPTIONS: { value: CommandType; label: string; description: string }[] = [
  { value: 'set_sleep', label: 'Cambiar intervalo', description: 'Tiempo entre envíos (minutos)' },
  { value: 'enable_sensor', label: 'Activar/desactivar sensor', description: 'Habilitar o deshabilitar un sensor del nodo' },
  { value: 'restart', label: 'Reiniciar', description: 'Reinicio suave del ESP32' },
]

// La batería no se puede activar/desactivar por comando — el firmware siempre la reporta.
const SENSOR_TYPES = ['SHTC3', 'GY39', 'DS18B20', 'GPS']

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  relayed: 'bg-blue-100 text-blue-700',
  acked: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  relayed: 'Retransmitido',
  acked: 'Confirmado',
  failed: 'Error',
}

function EmitterPanel({ device, onClose }: { device: EmitterItem; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(device.name)
  const [sleepMin, setSleepMin] = useState(Number(device.config?.sleep_minutes ?? 10))
  const [deleting, setDeleting] = useState(false)

  // Command form
  const [showCmdForm, setShowCmdForm] = useState(false)
  const [cmdType, setCmdType] = useState<CommandType>('set_sleep')
  const [cmdSleep, setCmdSleep] = useState(10)
  const [cmdSensor, setCmdSensor] = useState('GY39')
  const [cmdEnable, setCmdEnable] = useState(true)

  const lastSeen = device.last_seen
    ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true, locale: es })
    : null

  const { data: commands = [], refetch: refetchCmds } = useQuery({
    queryKey: ['commands', device.id],
    queryFn: () => getDeviceCommands(device.id),
  })

  const save = useMutation({
    mutationFn: () => updateDevice(device.id, {
      name,
      config: { ...device.config, sleep_minutes: sleepMin },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topology'] }); toast.success('Cambios guardados'); onClose() },
    onError: () => toast.error('Error al guardar'),
  })

  const del = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topology'] }); qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${device.name} eliminado`); onClose()
    },
    onError: () => toast.error('No se pudo eliminar'),
  })

  function buildParams(): Record<string, unknown> {
    if (cmdType === 'set_sleep') return { minutes: cmdSleep }
    if (cmdType === 'enable_sensor') return { sensor: cmdSensor, enable: cmdEnable }
    return {}
  }

  const sendCmd = useMutation({
    mutationFn: () => createCommand(device.id, cmdType, buildParams()),
    onSuccess: () => { toast.success('Comando encolado — el receptor lo retransmitirá en el próximo ciclo'); setShowCmdForm(false); refetchCmds() },
    onError: () => toast.error('Error al enviar comando'),
  })

  const cancelCmd = useMutation({
    mutationFn: (cmdId: number) => deleteCommand(cmdId),
    onSuccess: () => refetchCmds(),
    onError: () => toast.error('No se pudo cancelar'),
  })

  const q = rssiQuality(device.last_rssi)

  return (
    <PanelShell
      title={device.name} subtitle="Emisor / Nodo sensor" icon="📡" accent="bg-green-50"
      onClose={onClose}
      footer={
        <div className="px-5 py-4 space-y-2">
          <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}
            className="w-full px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {save.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {!deleting ? (
            <button onClick={() => setDeleting(true)} className="w-full px-4 py-2.5 border border-red-200 text-red-500 rounded-xl text-sm hover:bg-red-50 transition-colors">
              🗑 Eliminar emisor
            </button>
          ) : (
            <div className="border border-red-300 rounded-xl p-3 space-y-2">
              <p className="text-xs text-red-600 text-center">¿Seguro? Se perderán los datos de telemetría.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleting(false)} className="flex-1 px-3 py-2 text-xs border rounded-lg hover:bg-gray-50">Cancelar</button>
                <button onClick={() => del.mutate()} disabled={del.isPending}
                  className="flex-1 px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {del.isPending ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <div className="px-5 py-4 space-y-5">

        {/* Status row */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-xl p-3 text-center ${device.is_online ? 'bg-green-50' : 'bg-gray-50'}`}>
            <p className="text-lg">{device.is_online ? '🟢' : '⚫'}</p>
            <p className={`text-xs font-medium mt-0.5 ${device.is_online ? 'text-green-700' : 'text-gray-500'}`}>
              {device.is_online ? 'Online' : 'Offline'}
            </p>
          </div>
          <div className="rounded-xl p-3 text-center bg-gray-50">
            <div className="flex justify-center mb-0.5"><RssiBars rssi={device.last_rssi} /></div>
            <p className={`text-xs font-medium ${q.color}`}>{device.last_rssi !== null ? `${device.last_rssi} dBm` : '—'}</p>
            <p className="text-xs text-gray-400">RSSI</p>
          </div>
          <div className="rounded-xl p-3 text-center bg-gray-50">
            <p className="text-base font-bold text-gray-700 leading-tight">{sleepMin}<span className="text-xs font-normal text-gray-400"> min</span></p>
            <p className="text-xs text-gray-400 mt-0.5">Intervalo</p>
          </div>
        </div>

        {lastSeen && <p className="text-xs text-gray-400 text-center">Último dato {lastSeen}</p>}

        {/* Sensors */}
        {device.sensors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sensores</p>
            <div className="flex flex-wrap gap-1.5">
              {device.sensors.map((s) => (
                <span key={s.sensor_type} className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  {s.sensor_type}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Edit fields */}
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Intervalo de envío (minutos)">
          <Input type="number" min={1} max={60} value={sleepMin} onChange={(e) => setSleepMin(Number(e.target.value))} />
        </Field>

        {/* Remote commands */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Configuración remota</p>
            <button
              onClick={() => setShowCmdForm(!showCmdForm)}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              + Enviar comando
            </button>
          </div>

          {showCmdForm && (
            <div className="border rounded-xl p-3 space-y-3 bg-gray-50 mb-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Tipo de comando</label>
                <select
                  value={cmdType}
                  onChange={(e) => setCmdType(e.target.value as CommandType)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
                >
                  {CMD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400">{CMD_OPTIONS.find((o) => o.value === cmdType)?.description}</p>
              </div>

              {cmdType === 'set_sleep' && (
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Nuevo intervalo (minutos)</label>
                  <Input type="number" min={1} max={60} value={cmdSleep} onChange={(e) => setCmdSleep(Number(e.target.value))} />
                </div>
              )}
              {cmdType === 'enable_sensor' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-500">Sensor</label>
                    <select value={cmdSensor} onChange={(e) => setCmdSensor(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300">
                      {SENSOR_TYPES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    {[{ v: true, label: 'Activar' }, { v: false, label: 'Desactivar' }].map(({ v, label }) => (
                      <button key={label} type="button" onClick={() => setCmdEnable(v)}
                        className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          cmdEnable === v ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 hover:bg-white'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setShowCmdForm(false)} className="flex-1 px-3 py-2 text-xs border rounded-lg hover:bg-white">
                  Cancelar
                </button>
                <button onClick={() => sendCmd.mutate()} disabled={sendCmd.isPending}
                  className="flex-1 px-3 py-2 text-xs bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50">
                  {sendCmd.isPending ? 'Encolando…' : '📤 Enviar'}
                </button>
              </div>
            </div>
          )}

          {/* Commands list */}
          {commands.length > 0 ? (
            <div className="space-y-1.5">
              {commands.map((cmd: DeviceCommand) => (
                <div key={cmd.id} className="flex items-start gap-2 border rounded-xl px-3 py-2.5 bg-white">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-gray-800 truncate">{cmd.command_label}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_BADGE[cmd.status]}`}>
                        {STATUS_LABEL[cmd.status]}
                      </span>
                    </div>
                    {Object.keys(cmd.params).length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {Object.entries(cmd.params).map(([k, v]) => `${k}: ${v}`).join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-gray-300 mt-0.5">
                      {formatDistanceToNow(new Date(cmd.created_at), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                  {cmd.status === 'pending' && (
                    <button
                      onClick={() => cancelCmd.mutate(cmd.id)}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0 mt-0.5"
                      title="Cancelar comando"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-3">Sin comandos enviados aún</p>
          )}
        </div>

        {/* Quick links */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Accesos rápidos</p>
          <a href={`/devices/${device.id}/flash`}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 transition-colors">
            <span>⚡ Flash firmware</span><span className="text-gray-400">→</span>
          </a>
          <a href={`/devices/${device.id}`}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50 transition-colors">
            <span>📊 Ver telemetría</span><span className="text-gray-400">→</span>
          </a>
        </div>
      </div>
    </PanelShell>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TopologyPage() {
  const qc = useQueryClient()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selected, setSelected] = useState<
    | { type: 'receptor'; device: ReceptorItem }
    | { type: 'emitter'; device: EmitterItem }
    | null
  >(null)

  const { data: topology, isLoading } = useQuery<TopologyData>({
    queryKey: ['topology'],
    queryFn: async () => { const { data } = await api.get('/api/devices/topology/'); return data },
    refetchInterval: 5_000,
  })

  const assign = useMutation({
    mutationFn: ({ emitterId, receptorId }: { emitterId: number; receptorId: number | null }) =>
      api.patch(`/api/devices/${emitterId}/`, { assigned_gateway: receptorId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topology'] }); qc.invalidateQueries({ queryKey: ['devices'] }) },
    onError: () => toast.error('Error al guardar la conexión'),
  })

  useEffect(() => {
    if (!topology) return
    const { nodes: n, edges: e } = buildGraph(topology)
    setNodes(n)
    setEdges(e)
  }, [topology, setNodes, setEdges])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return
    const emitterId = parseInt(params.source.replace('e-', ''))
    const receptorId = parseInt(params.target.replace('r-', ''))
    if (isNaN(emitterId) || isNaN(receptorId)) return
    setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#16a34a', strokeWidth: 2 } }, eds))
    assign.mutate({ emitterId, receptorId })
    toast.success('Emisor conectado')
  }, [assign, setEdges])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const edge of deleted) {
      const emitterId = parseInt(edge.source.replace('e-', ''))
      if (!isNaN(emitterId)) { assign.mutate({ emitterId, receptorId: null }); toast.success('Emisor desconectado') }
    }
  }, [assign])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'receptor') {
      setSelected({ type: 'receptor', device: node.data as unknown as ReceptorItem })
    } else {
      setSelected({ type: 'emitter', device: node.data as unknown as EmitterItem })
    }
  }, [])

  const totalDevices = (topology?.receptors.length ?? 0) +
    (topology?.receptors.reduce((a, r) => a + r.emitters.length, 0) ?? 0) +
    (topology?.unassigned.length ?? 0)

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-shrink-0 gap-4">
        <div>
          <h1 className="text-2xl font-bold">Topología de red</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Conectar: arrastrá el handle de un emisor → receptor.
            Desconectar: seleccioná una línea + <kbd className="text-xs bg-gray-100 px-1 rounded border">Delete</kbd>.
            Editar: clic en cualquier bloque.
          </p>
        </div>
        {topology && (
          <div className="flex gap-3 flex-shrink-0">
            <div className="bg-blue-50 rounded-xl px-4 py-2 text-center">
              <p className="text-xl font-bold text-blue-700">{topology.receptors.length}</p>
              <p className="text-xs text-blue-500">Receptores</p>
            </div>
            <div className="bg-green-50 rounded-xl px-4 py-2 text-center">
              <p className="text-xl font-bold text-green-700">{topology.receptors.reduce((a, r) => a + r.emitters.length, 0)}</p>
              <p className="text-xs text-green-500">Conectados</p>
            </div>
            {topology.unassigned.length > 0 && (
              <div className="bg-amber-50 rounded-xl px-4 py-2 text-center">
                <p className="text-xl font-bold text-amber-700">{topology.unassigned.length}</p>
                <p className="text-xs text-amber-500">Sin asignar</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 rounded-2xl border bg-white overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Cargando…</div>
        ) : totalDevices === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
            <p className="text-5xl">🌐</p>
            <p className="font-semibold text-lg">Sin dispositivos</p>
            <a href="/devices/new" className="text-sm text-green-600 underline">Registrar dispositivo →</a>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onEdgesDelete={onEdgesDelete} onNodeClick={onNodeClick}
            nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }} deleteKeyCode="Delete"
          >
            <Background color="#f0f0f0" gap={24} />
            <Controls />
            <MiniMap nodeColor={(n) => (n.type === 'receptor' ? '#3b82f6' : '#16a34a')} maskColor="rgba(0,0,0,0.04)" />
          </ReactFlow>
        )}
      </div>

      {/* Side panels */}
      {selected?.type === 'receptor' && (
        <ReceptorPanel key={selected.device.id} device={selected.device} onClose={() => setSelected(null)} />
      )}
      {selected?.type === 'emitter' && (
        <EmitterPanel key={selected.device.id} device={selected.device} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
