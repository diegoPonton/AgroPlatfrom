'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { updateDevice } from '@/lib/devices'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface GpsCoords {
  lat: number
  lng: number
  alt?: number | null
  sats?: number | null
  hdop?: number | null
  source?: 'sensor' | 'manual'
}

interface GpsNode {
  id: number
  device_id: string
  name: string
  device_type: 'emisor' | 'receptor'
  is_online: boolean
  last_seen: string | null
  sensors: { sensor_type: string }[]
  gps: GpsCoords | null
  last_rssi: number | null
  assigned_gateway_id: number | null
  config: Record<string, unknown>
}

interface GpsLink { emitter_id: number; receptor_id: number; distance_m: number }
interface MapData { nodes: GpsNode[]; links: GpsLink[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDist(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} km`
}

function rssiColor(rssi: number | null) {
  if (rssi === null) return '#9ca3af'
  if (rssi >= -60) return '#16a34a'
  if (rssi >= -75) return '#22c55e'
  if (rssi >= -90) return '#f59e0b'
  return '#ef4444'
}

function rssiLabel(rssi: number | null) {
  if (rssi === null) return '—'
  if (rssi >= -60) return 'Excelente'
  if (rssi >= -75) return 'Buena'
  if (rssi >= -90) return 'Regular'
  return 'Débil'
}

// ─── Leaflet DivIcon Factories ───────────────────────────────────────────────────

function makeNodeIcon(type: 'emisor' | 'receptor', online: boolean): L.DivIcon {
  const isReceptor = type === 'receptor'
  const color = isReceptor ? '#3b82f6' : '#22c55e'
  const size = isReceptor ? 38 : 30
  const emoji = isReceptor ? '🔌' : '📡'
  const pulse = online
    ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};animation:mapNodePing 2s ease-out infinite;opacity:0.35;pointer-events:none"></div>`
    : ''
  const offlineDot = !online
    ? `<div style="position:absolute;top:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#9ca3af;border:1.5px solid white;z-index:2"></div>`
    : ''
  return L.divIcon({
    className: 'agro-node-icon',
    iconSize: [size + 10, size + 10],
    iconAnchor: [(size + 10) / 2, (size + 10) / 2],
    tooltipAnchor: [0, -(size / 2 + 6)],
    html: `
      <div style="position:relative;width:${size + 10}px;height:${size + 10}px;display:flex;align-items:center;justify-content:center">
        ${pulse}
        <div style="
          position:relative;z-index:1;
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};border:2.5px solid white;
          box-shadow:0 3px 12px ${color}88,0 1px 4px rgba(0,0,0,.3);
          display:flex;align-items:center;justify-content:center;
          font-size:${Math.round(size * 0.42)}px;cursor:pointer;
        ">${emoji}</div>
        ${offlineDot}
      </div>
    `,
  })
}

// ─── Three.js 3D Network Mini-Scene ─────────────────────────────────────────────

function ThreeNetworkScene({ nodes, links }: { nodes: GpsNode[]; links: GpsLink[] }) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const withGps = nodes.filter(n => n.gps)
    if (withGps.length === 0) return

    const W = mount.clientWidth || 288
    const H = mount.clientHeight || 192

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x030d18, 0.06)

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 200)
    camera.position.set(0, 7, 12)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.AmbientLight(0x112233, 1.8))
    const sun = new THREE.DirectionalLight(0x8ab4f8, 1.4)
    sun.position.set(8, 15, 6)
    scene.add(sun)

    // Ground grid
    const grid = new THREE.GridHelper(22, 22, 0x1e3a5a, 0x0d1f30)
    ;(grid.material as THREE.LineBasicMaterial).opacity = 0.45
    ;(grid.material as THREE.LineBasicMaterial).transparent = true
    scene.add(grid)

    // Normalize GPS → [-5, 5]
    const lats = withGps.map(n => n.gps!.lat)
    const lngs = withGps.map(n => n.gps!.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const latRange = maxLat - minLat || 0.001
    const lngRange = maxLng - minLng || 0.001
    const mapScale = 9 / Math.max(latRange, lngRange)
    const cLat = (minLat + maxLat) / 2
    const cLng = (minLng + maxLng) / 2

    function to3D(lat: number, lng: number): THREE.Vector3 {
      return new THREE.Vector3((lng - cLng) * mapScale, 0, -(lat - cLat) * mapScale)
    }

    const positions = new Map<number, THREE.Vector3>()
    const lights: Array<{ light: THREE.PointLight; baseIntensity: number }> = []

    withGps.forEach(node => {
      const pos = to3D(node.gps!.lat, node.gps!.lng)
      positions.set(node.id, pos)

      const isR = node.device_type === 'receptor'
      const color = isR ? 0x3b82f6 : 0x22c55e
      const emissiveColor = isR ? 0x1d4ed8 : 0x15803d
      const r = isR ? 0.38 : 0.27

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 16),
        new THREE.MeshStandardMaterial({ color, emissive: emissiveColor, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.5 })
      )
      sphere.position.set(pos.x, r, pos.z)
      scene.add(sphere)

      if (node.is_online) {
        const pl = new THREE.PointLight(color, 1.8, isR ? 6 : 4)
        pl.position.set(pos.x, r + 0.8, pos.z)
        scene.add(pl)
        lights.push({ light: pl, baseIntensity: 1.8 })
      }

      if (isR) {
        const tower = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8),
          new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.8 })
        )
        tower.position.set(pos.x + 0.28, 1.2, pos.z)
        scene.add(tower)
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 })
        )
        tip.position.set(pos.x + 0.28, 2.2, pos.z)
        scene.add(tip)
      }
    })

    // Connection lines
    const nodeById = new Map(nodes.map(n => [n.id, n]))
    links.forEach(link => {
      const posA = positions.get(link.emitter_id)
      const posB = positions.get(link.receptor_id)
      if (!posA || !posB) return
      const pts = [new THREE.Vector3(posA.x, 0.08, posA.z), new THREE.Vector3(posB.x, 0.08, posB.z)]
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.5 })
      )
      scene.add(line)
    })

    // Data packets
    type Packet = { mesh: THREE.Mesh; t: number; from: THREE.Vector3; to: THREE.Vector3; speed: number }
    const packets: Packet[] = []

    function spawnPacket(link: GpsLink) {
      const posA = positions.get(link.emitter_id)
      const posB = positions.get(link.receptor_id)
      if (!posA || !posB) return
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 1 })
      )
      const trail = new THREE.PointLight(0x00ff88, 0.6, 2)
      mesh.add(trail)
      scene.add(mesh)
      packets.push({
        mesh,
        t: 0,
        from: new THREE.Vector3(posA.x, 0.35, posA.z),
        to: new THREE.Vector3(posB.x, 0.35, posB.z),
        speed: 0.35 + Math.random() * 0.15,
      })
    }

    links.forEach(l => spawnPacket(l))

    // LoRa rings
    type Ring = { mesh: THREE.Mesh; life: number; scale: number }
    const rings: Ring[] = []

    function spawnRing(pos: THREE.Vector3, color: number) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.2, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(pos.x, 0.06, pos.z)
      scene.add(mesh)
      rings.push({ mesh, life: 0, scale: 0.1 })
    }

    const clock = new THREE.Clock()
    let elapsed = 0
    let ringTimer = 0
    let packetTimer = 0
    let ringIdx = 0
    let frameId: number

    function animate() {
      frameId = requestAnimationFrame(animate)
      const dt = clock.getDelta()
      elapsed += dt
      ringTimer += dt
      packetTimer += dt

      camera.position.x = Math.sin(elapsed * 0.18) * 12
      camera.position.z = Math.cos(elapsed * 0.18) * 12
      camera.position.y = 6 + Math.sin(elapsed * 0.12) * 1.2
      camera.lookAt(0, 0, 0)

      lights.forEach(({ light, baseIntensity }, i) => {
        light.intensity = baseIntensity + Math.sin(elapsed * 2.5 + i * 0.7) * 0.6
      })

      if (ringTimer > 0.65 && withGps.length > 0) {
        ringTimer = 0
        const node = withGps[ringIdx % withGps.length]
        const pos = positions.get(node.id)
        if (pos) spawnRing(pos, node.device_type === 'receptor' ? 0x3b82f6 : 0x22c55e)
        ringIdx++
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]
        r.life += dt
        r.scale += dt * 2.8
        r.mesh.scale.setScalar(r.scale)
        ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - r.life / 2.2))
        if (r.life >= 2.2) { scene.remove(r.mesh); rings.splice(i, 1) }
      }

      if (packetTimer > 2.8) {
        packetTimer = 0
        links.forEach(l => spawnPacket(l))
      }

      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]
        p.t = Math.min(1, p.t + dt * p.speed)
        const t = p.t
        const mx = (p.from.x + p.to.x) / 2
        const mz = (p.from.z + p.to.z) / 2
        const arc = Math.max(1.5, Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z) * 0.45)
        p.mesh.position.x = (1 - t) ** 2 * p.from.x + 2 * (1 - t) * t * mx + t ** 2 * p.to.x
        p.mesh.position.y = (1 - t) ** 2 * p.from.y + 2 * (1 - t) * t * (p.from.y + arc) + t ** 2 * p.to.y
        p.mesh.position.z = (1 - t) ** 2 * p.from.z + 2 * (1 - t) * t * mz + t ** 2 * p.to.z
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15
        if (p.t >= 1) { scene.remove(p.mesh); packets.splice(i, 1) }
      }

      renderer.render(scene, camera)
    }

    animate()

    const onResize = () => {
      if (!mount) return
      const w = mount.clientWidth, h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [nodes, links])

  return <div ref={mountRef} className="w-full h-full" />
}

// ─── Map internals (hooks must be inside MapContainer) ───────────────────────────

function MapAutoCenter({ nodes }: { nodes: GpsNode[] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    const gpsNodes = nodes.filter(n => n.gps)
    if (gpsNodes.length === 0) return
    if (gpsNodes.length === 1) {
      map.setView([gpsNodes[0].gps!.lat, gpsNodes[0].gps!.lng], 15)
    } else {
      map.fitBounds(
        L.latLngBounds(gpsNodes.map(n => [n.gps!.lat, n.gps!.lng] as [number, number])),
        { padding: [60, 60] }
      )
    }
    done.current = true
  }, [nodes, map])
  return null
}

function MapClickHandler({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => { if (active) onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

// ─── Node Info Panel ─────────────────────────────────────────────────────────────

function NodePanel({
  node, nodes, links, onClose, onSetLocation,
}: {
  node: GpsNode
  nodes: GpsNode[]
  links: GpsLink[]
  onClose: () => void
  onSetLocation: () => void
}) {
  const qc = useQueryClient()
  const [manualLat, setManualLat] = useState(String(node.gps?.lat ?? ''))
  const [manualLng, setManualLng] = useState(String(node.gps?.lng ?? ''))
  const [showManual, setShowManual] = useState(false)

  const lastSeen = node.last_seen
    ? formatDistanceToNow(new Date(node.last_seen), { addSuffix: true, locale: es })
    : null

  const connected = links.filter(
    l => l.emitter_id === node.id || l.receptor_id === node.id
  )

  const saveManual = useMutation({
    mutationFn: () => updateDevice(node.id, {
      config: { ...node.config, location: { lat: parseFloat(manualLat), lng: parseFloat(manualLng) } },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gps-map'] })
      toast.success('Coordenadas guardadas')
      setShowManual(false)
    },
    onError: () => toast.error('Error al guardar'),
  })

  const clearManual = useMutation({
    mutationFn: () => {
      const cfg = { ...node.config }
      delete cfg.location
      return updateDevice(node.id, { config: cfg })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gps-map'] }); toast.success('Posición manual eliminada') },
    onError: () => toast.error('Error al eliminar'),
  })

  const isReceptor = node.device_type === 'receptor'
  const color = isReceptor ? 'text-blue-600' : 'text-green-600'
  const bg = isReceptor ? 'bg-blue-50' : 'bg-green-50'

  return (
    <>
      <div className="fixed inset-0 z-[1100]" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[1200] w-80 bg-white border-l shadow-2xl flex flex-col overflow-y-auto">

        {/* Header */}
        <div className={`px-5 py-4 border-b ${bg}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{isReceptor ? '🔌' : '📡'}</span>
              <div>
                <p className="text-xs text-gray-500">{isReceptor ? 'Receptor · Gateway' : 'Emisor · Nodo Sensor'}</p>
                <p className="font-semibold text-sm leading-tight">{node.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-7 h-7 flex items-center justify-center">×</button>
          </div>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5">

          {/* Status chips */}
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-xl p-3 text-center ${node.is_online ? 'bg-green-50' : 'bg-gray-50'}`}>
              <p className="text-base">{node.is_online ? '🟢' : '⚫'}</p>
              <p className={`text-xs font-medium mt-0.5 ${node.is_online ? 'text-green-700' : 'text-gray-500'}`}>
                {node.is_online ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="rounded-xl p-3 text-center bg-gray-50">
              {node.last_rssi !== null ? (
                <>
                  <p className="text-sm font-bold" style={{ color: rssiColor(node.last_rssi) }}>{node.last_rssi} dBm</p>
                  <p className="text-xs text-gray-400">RSSI</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-400">—</p>
                  <p className="text-xs text-gray-400">RSSI</p>
                </>
              )}
            </div>
            <div className="rounded-xl p-3 text-center bg-gray-50">
              <p className="text-xs font-bold text-gray-700">{connected.length}</p>
              <p className="text-xs text-gray-400">Links</p>
            </div>
          </div>

          {lastSeen && <p className="text-xs text-gray-400 text-center">Último dato {lastSeen}</p>}

          {/* GPS info */}
          {node.gps ? (
            <div className="bg-emerald-50 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-emerald-700">📍 Coordenadas GPS</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${node.gps.source === 'sensor' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {node.gps.source === 'sensor' ? 'Sensor' : 'Manual'}
                </span>
              </div>
              <p className="text-xs font-mono text-emerald-800">
                {node.gps.lat.toFixed(6)}, {node.gps.lng.toFixed(6)}
              </p>
              {node.gps.alt !== null && node.gps.alt !== undefined && (
                <p className="text-xs text-emerald-600">Alt: {node.gps.alt.toFixed(1)} m</p>
              )}
              {node.gps.sats !== null && node.gps.sats !== undefined && (
                <p className="text-xs text-emerald-600">
                  Satélites: {node.gps.sats}
                  {node.gps.hdop !== null && node.gps.hdop !== undefined && ` · HDOP: ${node.gps.hdop}`}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-amber-50 rounded-xl p-3">
              <p className="text-xs text-amber-700 font-medium">Sin posición GPS</p>
              <p className="text-xs text-amber-600 mt-0.5">Sin sensor GPS activo ni coordenadas manuales.</p>
            </div>
          )}

          {/* Connected links */}
          {connected.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Links LoRa</p>
              {connected.map(link => {
                const peer = nodes.find(n =>
                  n.id === (link.emitter_id === node.id ? link.receptor_id : link.emitter_id)
                )
                return (
                  <div key={`${link.emitter_id}-${link.receptor_id}`} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-xs text-gray-700 truncate">{peer?.name ?? '—'}</span>
                    <span className="text-xs font-medium text-green-700 flex-shrink-0 ml-2">{fmtDist(link.distance_m)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* RSSI quality bar */}
          {node.last_rssi !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Calidad señal LoRa</span>
                <span className="font-medium" style={{ color: rssiColor(node.last_rssi) }}>{rssiLabel(node.last_rssi)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, (node.last_rssi + 110) / 50 * 100))}%`,
                    background: rssiColor(node.last_rssi),
                  }}
                />
              </div>
            </div>
          )}

          {/* Sensors */}
          {node.sensors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sensores</p>
              <div className="flex flex-wrap gap-1.5">
                {node.sensors.map(s => (
                  <span key={s.sensor_type} className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    {s.sensor_type}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Manual GPS input */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Posición en mapa</p>
            <button
              onClick={onSetLocation}
              className="w-full text-left px-3 py-2.5 border border-dashed border-green-400 rounded-xl text-sm text-green-700 hover:bg-green-50 transition-colors"
            >
              🖱️ Clic en el mapa para fijar posición
            </button>
            <button
              onClick={() => setShowManual(!showManual)}
              className="w-full text-left px-3 py-2 border rounded-xl text-xs text-gray-600 hover:bg-gray-50"
            >
              ✏️ Ingresar coordenadas manualmente
            </button>

            {showManual && (
              <div className="border rounded-xl p-3 space-y-2 bg-gray-50">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Latitud</label>
                    <input
                      type="number" step="0.000001"
                      value={manualLat}
                      onChange={e => setManualLat(e.target.value)}
                      placeholder="14.0839"
                      className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-300 mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Longitud</label>
                    <input
                      type="number" step="0.000001"
                      value={manualLng}
                      onChange={e => setManualLng(e.target.value)}
                      placeholder="-87.2067"
                      className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-300 mt-0.5"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveManual.mutate()}
                    disabled={saveManual.isPending || !manualLat || !manualLng}
                    className="flex-1 px-3 py-1.5 bg-green-700 text-white text-xs rounded-lg hover:bg-green-800 disabled:opacity-50"
                  >
                    {saveManual.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                  {node.gps?.source === 'manual' && (
                    <button
                      onClick={() => clearManual.mutate()}
                      disabled={clearManual.isPending}
                      className="px-3 py-1.5 border border-red-200 text-red-500 text-xs rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Accesos</p>
            <a href={`/devices/${node.id}`}
              className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
              <span>📊 Ver telemetría</span><span className="text-gray-400">→</span>
            </a>
            <a href="/topology"
              className="flex items-center justify-between w-full px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
              <span>🗺️ Topología de red</span><span className="text-gray-400">→</span>
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Main Map Component (exported — loaded with ssr:false) ────────────────────────

export default function GpsMap() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<GpsNode | null>(null)
  const [picking, setPicking] = useState(false)

  const { data, isLoading } = useQuery<MapData>({
    queryKey: ['gps-map'],
    queryFn: async () => { const { data } = await api.get('/api/devices/gps-map/'); return data },
    refetchInterval: 12_000,
  })

  const nodes = data?.nodes ?? []
  const links = data?.links ?? []
  const withGps = nodes.filter(n => n.gps)
  const noGps = nodes.filter(n => !n.gps)
  const online = nodes.filter(n => n.is_online).length
  const maxDist = links.length ? Math.max(...links.map(l => l.distance_m)) : 0

  const nodeById = new Map(nodes.map(n => [n.id, n]))

  const handleSetLocation = useCallback(() => {
    setPicking(true)
  }, [])

  const handlePickCoords = useCallback((lat: number, lng: number) => {
    if (!selected) return
    updateDevice(selected.id, {
      config: { ...selected.config, location: { lat, lng } },
    }).then(() => {
      qc.invalidateQueries({ queryKey: ['gps-map'] })
      toast.success(`Posición de ${selected.name} guardada`)
      setPicking(false)
    }).catch(() => toast.error('Error al guardar'))
  }, [selected, qc])

  const defaultCenter: [number, number] = [14.0839, -87.2067]

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
        <span className="animate-spin">⏳</span> Cargando mapa GPS…
      </div>
    )
  }

  return (
    <>
      {/* Inject CSS animation for marker ping */}
      <style>{`
        @keyframes mapNodePing {
          0% { transform: scale(0.85); opacity: 0.5; }
          70%, 100% { transform: scale(2.8); opacity: 0; }
        }
        .agro-node-icon { background: transparent !important; border: none !important; }
        .leaflet-tooltip { border-radius: 8px !important; font-family: inherit !important; }
      `}</style>

      <div className="relative h-full flex">

        {/* Leaflet Map */}
        <div className={`relative flex-1 ${picking ? 'cursor-crosshair' : ''}`}>
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ width: '100%', height: '100%', background: '#0f172a' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapAutoCenter nodes={withGps} />
            <MapClickHandler active={picking} onPick={handlePickCoords} />

            {/* Node markers */}
            {withGps.map(node => (
              <Marker
                key={node.id}
                position={[node.gps!.lat, node.gps!.lng]}
                icon={makeNodeIcon(node.device_type, node.is_online)}
                eventHandlers={{ click: () => { setSelected(node); setPicking(false) } }}
              >
                <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
                  <div style={{ minWidth: 120 }}>
                    <p className="font-semibold text-xs">{node.name}</p>
                    <p className="text-xs text-gray-500">
                      {node.device_type === 'receptor' ? '🔌 Receptor' : '📡 Emisor'} ·{' '}
                      <span style={{ color: node.is_online ? '#16a34a' : '#9ca3af' }}>
                        {node.is_online ? 'Online' : 'Offline'}
                      </span>
                    </p>
                    {node.last_rssi !== null && (
                      <p className="text-xs" style={{ color: rssiColor(node.last_rssi) }}>
                        RSSI: {node.last_rssi} dBm
                      </p>
                    )}
                    {node.gps?.source === 'manual' && (
                      <p className="text-xs text-amber-600">📌 Posición manual</p>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            ))}

            {/* Connection lines */}
            {links.map(link => {
              const emitter = nodeById.get(link.emitter_id)
              const receptor = nodeById.get(link.receptor_id)
              if (!emitter?.gps || !receptor?.gps) return null
              return (
                <Polyline
                  key={`${link.emitter_id}-${link.receptor_id}`}
                  positions={[
                    [emitter.gps.lat, emitter.gps.lng],
                    [receptor.gps.lat, receptor.gps.lng],
                  ]}
                  pathOptions={{ color: '#22c55e', weight: 2.5, opacity: 0.75, dashArray: '8 5' }}
                >
                  <Tooltip sticky>
                    <div>
                      <p className="text-xs font-semibold text-green-700">{emitter.name} → {receptor.name}</p>
                      <p className="text-xs text-gray-600">📏 {fmtDist(link.distance_m)}</p>
                      {emitter.last_rssi !== null && (
                        <p className="text-xs" style={{ color: rssiColor(emitter.last_rssi) }}>
                          RSSI: {emitter.last_rssi} dBm · {rssiLabel(emitter.last_rssi)}
                        </p>
                      )}
                    </div>
                  </Tooltip>
                </Polyline>
              )
            })}
          </MapContainer>

          {/* Stats badges — top center overlay */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[800] flex gap-2 pointer-events-none">
            <div className="bg-white/92 backdrop-blur-sm rounded-xl px-3 py-1.5 shadow-lg flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <span className={`w-2 h-2 rounded-full ${online > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {online}/{nodes.length} online
            </div>
            <div className="bg-white/92 backdrop-blur-sm rounded-xl px-3 py-1.5 shadow-lg text-xs font-medium text-gray-700">
              📍 {withGps.length} en mapa
            </div>
            {links.length > 0 && (
              <div className="bg-white/92 backdrop-blur-sm rounded-xl px-3 py-1.5 shadow-lg text-xs font-medium text-gray-700">
                🔗 {links.length} link{links.length > 1 ? 's' : ''} · {fmtDist(maxDist)} máx
              </div>
            )}
          </div>

          {/* Picking mode banner */}
          {picking && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[800] bg-amber-500 text-white rounded-xl px-4 py-2 shadow-xl text-sm font-medium flex items-center gap-2">
              <span className="animate-pulse">📍</span>
              Haz clic en el mapa para colocar "{selected?.name}"
              <button onClick={() => setPicking(false)} className="ml-2 underline text-xs opacity-80 hover:opacity-100">
                Cancelar
              </button>
            </div>
          )}

          {/* Three.js 3D mini-scene — bottom left */}
          {withGps.length > 0 && (
            <div className="absolute bottom-4 left-4 z-[800] w-72 h-48 rounded-2xl overflow-hidden border border-white/20 shadow-2xl">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/80 backdrop-blur-sm" />
              <div className="absolute top-2 left-3 z-10 text-xs text-white/70 font-medium select-none">
                🌐 Vista 3D Red LoRa
              </div>
              <ThreeNetworkScene nodes={nodes} links={links} />
            </div>
          )}

          {/* No GPS nodes warning */}
          {withGps.length === 0 && !isLoading && (
            <div className="absolute inset-0 z-[700] flex items-center justify-center pointer-events-none">
              <div className="bg-white/95 rounded-2xl p-6 shadow-xl text-center max-w-xs pointer-events-auto">
                <p className="text-4xl mb-3">🛰️</p>
                <p className="font-semibold text-gray-900">Sin posiciones GPS</p>
                <p className="text-sm text-gray-500 mt-1">
                  Ningún nodo tiene datos GPS activos. Selecciona un nodo del panel derecho y fija su posición manualmente.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-72 bg-white border-l flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="font-semibold text-sm">Nodos de la red</p>
            <p className="text-xs text-gray-500">{nodes.length} total · {online} online</p>
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* Nodes with GPS */}
            {withGps.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-green-50 border-b">
                  <p className="text-xs font-medium text-green-700 uppercase tracking-wide">En el mapa ({withGps.length})</p>
                </div>
                {withGps.map(node => (
                  <button
                    key={node.id}
                    onClick={() => { setSelected(node); setPicking(false) }}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${selected?.id === node.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${node.is_online ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="text-sm font-medium text-gray-900 truncate flex-1">{node.name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {node.device_type === 'receptor' ? '🔌' : '📡'}
                      </span>
                    </div>
                    <div className="mt-1 ml-4 flex items-center gap-3">
                      {node.gps && (
                        <span className="text-xs text-gray-400 font-mono">
                          {node.gps.lat.toFixed(4)}, {node.gps.lng.toFixed(4)}
                        </span>
                      )}
                      {node.gps?.source === 'manual' && (
                        <span className="text-xs text-amber-500">📌</span>
                      )}
                    </div>
                    {node.last_rssi !== null && (
                      <div className="mt-1 ml-4 text-xs" style={{ color: rssiColor(node.last_rssi) }}>
                        {node.last_rssi} dBm · {rssiLabel(node.last_rssi)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Links distances */}
            {links.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-green-50 border-b">
                  <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Distancias ({links.length})</p>
                </div>
                {links.map(link => {
                  const emitter = nodeById.get(link.emitter_id)
                  const receptor = nodeById.get(link.receptor_id)
                  return (
                    <div key={`${link.emitter_id}-${link.receptor_id}`} className="px-4 py-2.5 border-b">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-700 truncate">{emitter?.name} → {receptor?.name}</p>
                        </div>
                        <span className="text-xs font-bold text-green-700 flex-shrink-0 ml-2">{fmtDist(link.distance_m)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Nodes without GPS */}
            {noGps.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-amber-50 border-b">
                  <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Sin GPS ({noGps.length})</p>
                </div>
                {noGps.map(node => (
                  <button
                    key={node.id}
                    onClick={() => { setSelected(node); setPicking(false) }}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${selected?.id === node.id ? 'bg-amber-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${node.is_online ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="text-sm font-medium text-gray-700 truncate flex-1">{node.name}</span>
                      <span className="text-xs text-amber-500 flex-shrink-0">📍 fijar</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

          </div>

          {/* Mesh info footer */}
          <div className="border-t px-4 py-3 bg-gray-50 space-y-1">
            <p className="text-xs font-medium text-gray-700">Arquitectura actual</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Topología <strong>estrella</strong>: emisores → receptor → API.
              Para mesh o repetidores, ver guía.
            </p>
            <a href="/guide" className="text-xs text-green-600 underline">Ver guía de red →</a>
          </div>
        </div>
      </div>

      {/* Selected node panel */}
      {selected && (
        <NodePanel
          node={selected}
          nodes={nodes}
          links={links}
          onClose={() => setSelected(null)}
          onSetLocation={() => { handleSetLocation(); setSelected(null) }}
        />
      )}
    </>
  )
}
