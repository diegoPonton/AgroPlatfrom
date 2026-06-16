'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import Link from 'next/link'
import { getDevice, getTelemetryHistory, type Device } from '@/lib/devices'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelemetryReading {
  id: number
  received_at: string
  payload: Record<string, unknown>
  rssi: number | null
}

interface GatewayStats {
  total_relayed: number
  today_count: number
  avg_rssi: number | null
  emitters: {
    id: number
    name: string
    device_id: string
    is_online: boolean
    last_seen: string | null
    last_rssi: number | null
    sensors: { sensor_type: string }[]
  }[]
  rssi_history: {
    received_at: string
    rssi: number | null
    device_id: string
    device_name: string
  }[]
  activity: {
    received_at: string
    rssi: number | null
    device_id: string
    device_name: string
    payload_keys: string[]
  }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): number | null {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'number' ? cur : null
}

function rssiQuality(rssi: number | null): { label: string; color: string } {
  if (rssi === null) return { label: '—', color: 'text-gray-400' }
  if (rssi >= -60) return { label: 'Excelente', color: 'text-green-600' }
  if (rssi >= -75) return { label: 'Buena', color: 'text-green-500' }
  if (rssi >= -90) return { label: 'Regular', color: 'text-amber-500' }
  return { label: 'Débil', color: 'text-red-500' }
}

function RssiBars({ rssi }: { rssi: number | null }) {
  const bars = rssi === null ? 0 : rssi >= -60 ? 4 : rssi >= -75 ? 3 : rssi >= -90 ? 2 : 1
  const col = rssi === null ? 'bg-gray-200' : rssi >= -60 ? 'bg-green-500' : rssi >= -75 ? 'bg-green-400' : rssi >= -90 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <span className="inline-flex items-end gap-0.5">
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={`inline-block w-1.5 rounded-sm ${b <= bars ? col : 'bg-gray-200'}`} style={{ height: 4 + b * 3 }} />
      ))}
    </span>
  )
}

// ─── Shared header ────────────────────────────────────────────────────────────

function DeviceHeader({ device, liveCount }: { device: Device; liveCount: number }) {
  const lastSeen = device.last_seen
    ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true, locale: es })
    : null

  return (
    <div className="flex items-start justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-3xl">{device.device_type === 'receptor' ? '🔌' : '📡'}</span>
        <div>
          <h1 className="text-2xl font-bold leading-tight">{device.name}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{device.device_id}</p>
        </div>
        <Badge className={device.is_online ? 'bg-green-500' : ''} variant={device.is_online ? 'default' : 'secondary'}>
          {device.is_online ? '● En línea' : '○ Sin señal'}
        </Badge>
        {liveCount > 0 && (
          <Badge variant="outline" className="text-green-600 border-green-600 animate-pulse">⚡ Live</Badge>
        )}
        {lastSeen && <span className="text-xs text-muted-foreground">Último contacto {lastSeen}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Link href="/topology" className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors text-gray-600">
          🗺️ Topología
        </Link>
        <Link href={`/devices/${device.id}/flash`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors">
          ⚡ Flash
        </Link>
      </div>
    </div>
  )
}

// ─── RECEPTOR detail ──────────────────────────────────────────────────────────

const EMITTER_COLORS = ['#16a34a', '#3b82f6', '#f97316', '#a855f7', '#ef4444', '#eab308']

function ReceptorDetail({ device }: { device: Device }) {
  const cfg = device.config as Record<string, unknown>

  const { data: stats, isLoading } = useQuery<GatewayStats>({
    queryKey: ['gateway-stats', device.id],
    queryFn: async () => { const { data } = await api.get(`/api/devices/${device.id}/gateway-stats/`); return data },
    refetchInterval: 10_000,
  })

  // Build RSSI chart data — pivot rssi_history by emitter
  const emitterIds = stats?.emitters.map((e) => e.device_id) ?? []
  const rssiChart = (stats?.rssi_history ?? []).map((r) => {
    const point: Record<string, unknown> = { time: format(new Date(r.received_at), 'HH:mm', { locale: es }) }
    emitterIds.forEach((id) => { point[id] = r.device_id === id ? r.rssi : undefined })
    return point
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  const onlineEmitters = stats?.emitters.filter((e) => e.is_online).length ?? 0

  return (
    <div className="space-y-6">
      {/* Stat chips */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip label="Paquetes relayados" value={stats?.total_relayed ?? 0} color="bg-blue-50 text-blue-700" icon="📦" />
        <StatChip label="Hoy" value={stats?.today_count ?? 0} color="bg-green-50 text-green-700" icon="📅" />
        <StatChip label="Emisores online" value={`${onlineEmitters}/${stats?.emitters.length ?? 0}`} color="bg-indigo-50 text-indigo-700" icon="📡" />
        <StatChip
          label="RSSI promedio"
          value={stats?.avg_rssi != null ? `${stats.avg_rssi} dBm` : '—'}
          color={`${rssiQuality(stats?.avg_rssi ?? null).color.replace('text-', 'bg-').replace('600', '50').replace('500', '50')} ${rssiQuality(stats?.avg_rssi ?? null).color}`}
          icon="📶"
        />
      </div>

      {/* Main grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Network & config */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Red y configuración</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="WiFi" value={String(cfg?.wifi_ssid ?? '—')} icon="📶" />
            <InfoRow label="LoRa" value="915 MHz · SF7 · BW125" icon="📻" />
            <InfoRow label="Firmware" value={device.firmware_version || 'Sin flashear'} icon="💾" />
            <InfoRow label="Device ID" value={device.device_id} icon="🔑" mono />
            <div className="pt-2 border-t">
              <Link
                href={`/devices/${device.id}/flash`}
                className="flex items-center justify-between w-full rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 transition-colors"
              >
                <span className="text-sm font-medium">⚡ Flashear firmware</span>
                <span>→</span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Connected emitters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Emisores conectados</CardTitle>
          </CardHeader>
          <CardContent>
            {!stats?.emitters.length ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <p className="text-3xl mb-2">📡</p>
                <p>Sin emisores asignados</p>
                <Link href="/topology" className="text-green-600 underline text-xs mt-1 inline-block">
                  Asignar en topología →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.emitters.map((e, i) => (
                  <div key={e.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: EMITTER_COLORS[i % EMITTER_COLORS.length] }}
                      />
                      <div className="min-w-0">
                        <Link href={`/devices/${e.id}`} className="text-sm font-medium hover:underline truncate block">
                          {e.name}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${e.is_online ? 'bg-green-400' : 'bg-gray-300'}`} />
                          <span className="text-xs text-muted-foreground">{e.is_online ? 'Online' : 'Offline'}</span>
                          {e.sensors.length > 0 && (
                            <span className="text-xs text-gray-400">· {e.sensors.map((s) => s.sensor_type).join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <RssiBars rssi={e.last_rssi} />
                      <span className={`text-xs font-medium ${rssiQuality(e.last_rssi).color}`}>
                        {e.last_rssi != null ? `${e.last_rssi} dBm` : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RSSI chart */}
      {(stats?.rssi_history.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Señal LoRa recibida (RSSI dBm)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rssiChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} unit=" dBm" width={70} />
                <Tooltip formatter={(v) => `${v ?? ''} dBm`} />
                <Legend />
                {emitterIds.map((id, i) => (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={id}
                    name={stats?.emitters.find((e) => e.device_id === id)?.name ?? id}
                    stroke={EMITTER_COLORS[i % EMITTER_COLORS.length]}
                    dot={false}
                    connectNulls={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Activity log */}
      {(stats?.activity.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 font-medium">Hora</th>
                    <th className="text-left py-2 font-medium">Emisor</th>
                    <th className="text-left py-2 font-medium">RSSI</th>
                    <th className="text-left py-2 font-medium">Datos</th>
                  </tr>
                </thead>
                <tbody>
                  {stats!.activity.map((a, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {format(new Date(a.received_at), 'HH:mm:ss')}
                      </td>
                      <td className="py-2 font-medium">{a.device_name}</td>
                      <td className="py-2">
                        <span className={`flex items-center gap-1.5 ${rssiQuality(a.rssi).color}`}>
                          <RssiBars rssi={a.rssi} />
                          {a.rssi != null ? `${a.rssi} dBm` : '—'}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {a.payload_keys.filter((k) => k !== 'device_id' && k !== 'rssi').join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatChip({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div className={`rounded-2xl p-4 ${color}`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-xs mt-1 opacity-75">{label}</p>
    </div>
  )
}

function InfoRow({ label, value, icon, mono }: { label: string; value: string; icon: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-base w-5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm truncate ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</p>
      </div>
    </div>
  )
}

// ─── EMISOR detail ────────────────────────────────────────────────────────────

function EmitterDetail({ device, liveReadings, history }: {
  device: Device
  liveReadings: TelemetryReading[]
  history: TelemetryReading[]
}) {
  const allReadings = [...liveReadings, ...history]
    .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
    .slice(-50)

  const chartData = allReadings.map((r) => ({
    time: format(new Date(r.received_at), 'HH:mm', { locale: es }),
    'Temp. Amb. (°C)': getNestedValue(r.payload, 'amb.temp_c'),
    'Humedad (%)': getNestedValue(r.payload, 'amb.hum_pct'),
    'Temp. Sonda (°C)': getNestedValue(r.payload, 'probe.temp_c'),
    'Batería (%)': getNestedValue(r.payload, 'bat.pct'),
    'RSSI (dBm)': r.rssi,
  }))

  const latest = allReadings[allReadings.length - 1]
  const p = latest?.payload ?? {}
  const cfg = device.config as Record<string, unknown>

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Temp. Ambiente" value={getNestedValue(p, 'amb.temp_c')} unit="°C" available={!!(p as Record<string,unknown>)?.amb} />
        <KpiCard title="Humedad" value={getNestedValue(p, 'amb.hum_pct')} unit="%" available={!!(p as Record<string,unknown>)?.amb} />
        <KpiCard title="Temp. Sonda" value={getNestedValue(p, 'probe.temp_c')} unit="°C" available={!!(p as Record<string,unknown>)?.probe} />
        <KpiCard title="Batería" value={getNestedValue(p, 'bat.pct')} unit="%" available={!!(p as Record<string,unknown>)?.bat} />
      </div>

      {/* RSSI + Chart */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Historial (últimas 50 lecturas)</CardTitle>
            {latest?.rssi != null && (
              <div className="flex items-center gap-1.5">
                <RssiBars rssi={latest.rssi} />
                <span className={`text-xs font-medium ${rssiQuality(latest.rssi).color}`}>
                  {latest.rssi} dBm · {rssiQuality(latest.rssi).label}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Sin datos aún.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Temp. Amb. (°C)" stroke="#f97316" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Humedad (%)" stroke="#3b82f6" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Temp. Sonda (°C)" stroke="#ef4444" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Batería (%)" stroke="#22c55e" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Device info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Configuración y firmware</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Link
            href={`/devices/${device.id}/flash`}
            className="flex items-center justify-between w-full rounded-xl bg-green-600 hover:bg-green-700 text-white px-4 py-3 transition-colors"
          >
            <div>
              <p className="font-semibold text-sm">⚡ Flashear firmware desde la web</p>
              <p className="text-xs text-green-100 mt-0.5">Sin PlatformIO · Solo Chrome/Edge + cable USB</p>
            </div>
            <span>→</span>
          </Link>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Device ID" value={device.device_id} icon="🔑" mono />
            <InfoRow label="Intervalo" value={`${cfg?.sleep_minutes ?? 10} min`} icon="⏱" />
            <InfoRow label="Firmware" value={device.firmware_version || '—'} icon="💾" />
            {device.assigned_gateway_name && (
              <InfoRow label="Receptor" value={device.assigned_gateway_name} icon="🔌" />
            )}
            {device.sensors.length > 0 && (
              <div className="col-span-2">
                <InfoRow label="Sensores" value={device.sensors.map((s) => s.sensor_type).join(' · ')} icon="🌡️" />
              </div>
            )}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              Opción PlatformIO / VSCode
            </summary>
            <div className="mt-3 space-y-2 border-t pt-3">
              <p className="text-muted-foreground">
                Descargá el <code className="bg-gray-100 px-0.5 rounded">secrets.h</code> y copialo
                a <code className="bg-gray-100 px-0.5 rounded">src/emisor/secrets.h</code>.
              </p>
              <DownloadSecretsButton deviceId={device.id} />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
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
    <button onClick={download} className="inline-flex items-center gap-1 text-green-700 border border-green-300 rounded px-2 py-1.5 hover:bg-green-50 transition-colors text-xs">
      ↓ Descargar secrets.h
    </button>
  )
}

function KpiCard({ title, value, unit, available }: { title: string; value: number | null; unit: string; available: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        {!available ? (
          <p className="text-sm text-muted-foreground mt-1">No disponible</p>
        ) : value === null ? (
          <Skeleton className="h-8 w-16 mt-1" />
        ) : (
          <p className="text-2xl font-bold mt-1">{value.toFixed(1)}<span className="text-sm font-normal ml-1">{unit}</span></p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [liveReadings, setLiveReadings] = useState<TelemetryReading[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const { data: device, isLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: () => getDevice(Number(id)),
    refetchInterval: 10_000,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['telemetry', id],
    queryFn: () => getTelemetryHistory(Number(id), 50),
    enabled: !!id && device?.device_type === 'emisor',
  })

  useEffect(() => {
    if (!device?.device_id || device.device_type !== 'emisor') return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
    const ws = new WebSocket(`${apiBase.replace(/^http/, 'ws')}/ws/devices/${device.device_id}/`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data) as TelemetryReading
      setLiveReadings((prev) => [data, ...prev].slice(0, 100))
    }
    return () => ws.close()
  }, [device?.device_id, device?.device_type])

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (!device) return <p className="text-center py-20 text-muted-foreground">Dispositivo no encontrado</p>

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <DeviceHeader device={device} liveCount={liveReadings.length} />

      {device.device_type === 'receptor' ? (
        <ReceptorDetail device={device} />
      ) : (
        <EmitterDetail device={device} liveReadings={liveReadings} history={history} />
      )}
    </div>
  )
}
