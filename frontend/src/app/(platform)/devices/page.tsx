'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { getDevices, deleteDevice, type Device } from '@/lib/devices'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

type Filter = 'todos' | 'emisor' | 'receptor'

// ─── Stat chip ────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex flex-col items-center px-5 py-3 rounded-xl ${color}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs mt-0.5 opacity-75">{label}</span>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ device, onClose }: { device: Device; onClose: () => void }) {
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${device.name} eliminado`)
      onClose()
    },
    onError: () => toast.error('No se pudo eliminar el dispositivo'),
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-semibold mb-1">Eliminar dispositivo</p>
        <p className="text-sm text-muted-foreground mb-5">
          ¿Seguro que querés eliminar <strong>{device.name}</strong>? Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border text-sm hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {del.isPending ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Device card ──────────────────────────────────────────────────────────────

function DeviceCard({ device, onDelete }: { device: Device; onDelete: () => void }) {
  const router = useRouter()
  const cfg = device.config as Record<string, unknown>
  const sensors = device.sensors ?? []

  const lastSeen = device.last_seen
    ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true, locale: es })
    : null

  const isEmitter = device.device_type === 'emisor'

  return (
    <div
      className={`group relative bg-white rounded-2xl border-2 transition-all duration-200 hover:shadow-lg cursor-pointer overflow-hidden ${
        device.is_online ? 'border-green-200 hover:border-green-400' : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={() => router.push(`/devices/${device.id}`)}
    >
      {/* Online stripe */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${device.is_online ? 'bg-green-400' : 'bg-gray-200'}`} />

      <div className="p-5 pt-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl flex-shrink-0">{isEmitter ? '📡' : '🔌'}</span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate leading-tight">{device.name}</p>
              <code className="text-xs text-gray-400 font-mono">{device.device_id}</code>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
            device.is_online ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${device.is_online ? 'bg-green-500' : 'bg-gray-400'}`} />
            {device.is_online ? 'Online' : 'Offline'}
          </div>
        </div>

        {/* Info rows */}
        <div className="space-y-2 mb-4">
          {isEmitter && sensors.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sensors.map((s) => (
                <span key={s.sensor_type} className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                  {s.sensor_type}
                </span>
              ))}
            </div>
          )}

          {isEmitter && device.assigned_gateway_name && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <span className="text-gray-400">↗</span>
              <span className="truncate">{device.assigned_gateway_name}</span>
            </p>
          )}

          {!isEmitter && !!cfg?.wifi_ssid && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <span>📶</span>
              <span className="truncate">{String(cfg.wifi_ssid)}</span>
            </p>
          )}

          {isEmitter && !!cfg?.sleep_minutes && (
            <p className="text-xs text-gray-500">
              ⏱ Envía cada {String(cfg.sleep_minutes)} min
            </p>
          )}

          {device.firmware_version && (
            <p className="text-xs text-gray-400">FW v{device.firmware_version}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            {lastSeen ? `Último dato ${lastSeen}` : 'Sin datos aún'}
          </p>

          {/* Actions — stop propagation so clicks don't go to the card */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Link
              href={`/devices/${device.id}/flash`}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            >
              ⚡ Flash
            </Link>
            <Link
              href={`/devices/${device.id}`}
              className="px-2.5 py-1.5 text-xs rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              Ver →
            </Link>
            <button
              onClick={onDelete}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
              title="Eliminar"
            >
              🗑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-20 text-center gap-4">
      <div className="text-6xl">
        {filter === 'receptor' ? '🔌' : filter === 'emisor' ? '📡' : '🌱'}
      </div>
      <div>
        <p className="font-semibold text-lg text-gray-700">
          {filter === 'todos' ? 'Sin dispositivos registrados' : `Sin ${filter}es registrados`}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Registrá tu primer nodo para comenzar a monitorear.
        </p>
      </div>
      <Link
        href="/devices/new"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
      >
        + Registrar primer nodo
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DevicesPage() {
  const [filter, setFilter] = useState<Filter>('todos')
  const [search, setSearch] = useState('')
  const [toDelete, setToDelete] = useState<Device | null>(null)

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: getDevices,
    refetchInterval: 30_000,
  })

  const online = devices.filter((d) => d.is_online).length
  const offline = devices.length - online
  const receptores = devices.filter((d) => d.device_type === 'receptor').length
  const emisores = devices.filter((d) => d.device_type === 'emisor').length

  const filtered = devices.filter((d) => {
    const matchType = filter === 'todos' || d.device_type === filter
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.device_id.toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  // Split filtered by type for section headers
  const filteredReceptors = filtered.filter((d) => d.device_type === 'receptor')
  const filteredEmitters = filtered.filter((d) => d.device_type === 'emisor')

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Dispositivos</h1>
        <div className="flex items-center gap-2">
          <Link href="/topology" className="px-4 py-2 text-sm border rounded-xl hover:bg-gray-50 transition-colors text-gray-600">
            🗺️ Topología
          </Link>
          <Link
            href="/devices/new"
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
          >
            + Nuevo nodo
          </Link>
        </div>
      </div>

      {/* Stats */}
      {!isLoading && devices.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <Stat label="Total" value={devices.length} color="bg-gray-100 text-gray-700" />
          <Stat label="Online" value={online} color="bg-green-100 text-green-700" />
          <Stat label="Offline" value={offline} color="bg-gray-100 text-gray-500" />
          <Stat label="Receptores" value={receptores} color="bg-blue-100 text-blue-700" />
          <Stat label="Emisores" value={emisores} color="bg-indigo-100 text-indigo-700" />
        </div>
      )}

      {/* Filters + search */}
      {!isLoading && devices.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            {(['todos', 'emisor', 'receptor'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
                  filter === f ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'todos' ? 'Todos' : f + 'es'}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Buscar por nombre o ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className="grid"><EmptyState filter="todos" /></div>
      ) : (
        <div className="space-y-8">

          {/* Receptors section */}
          {(filter === 'todos' || filter === 'receptor') && filteredReceptors.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🔌</span>
                <h2 className="font-semibold text-gray-700">Receptores <span className="text-gray-400 font-normal">({filteredReceptors.length})</span></h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredReceptors.map((d) => (
                  <DeviceCard key={d.id} device={d} onDelete={() => setToDelete(d)} />
                ))}
              </div>
            </section>
          )}

          {/* Emitters section */}
          {(filter === 'todos' || filter === 'emisor') && filteredEmitters.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📡</span>
                <h2 className="font-semibold text-gray-700">Emisores <span className="text-gray-400 font-normal">({filteredEmitters.length})</span></h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredEmitters.map((d) => (
                  <DeviceCard key={d.id} device={d} onDelete={() => setToDelete(d)} />
                ))}
              </div>
            </section>
          )}

          {/* Empty filtered state */}
          {filtered.length === 0 && (
            <div className="grid"><EmptyState filter={filter} /></div>
          )}
        </div>
      )}

      {/* Delete modal */}
      {toDelete && <DeleteConfirm device={toDelete} onClose={() => setToDelete(null)} />}
    </div>
  )
}
