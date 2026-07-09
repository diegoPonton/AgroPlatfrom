'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createDevice, getReceptors } from '@/lib/devices'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const SENSOR_OPTIONS = [
  { type: 'SHTC3', label: 'SHTC3 — Temp/Humedad Ambiente' },
  { type: 'BME280', label: 'BME280 — Temp/Humedad/Presión Ambiente' },
  { type: 'DS18B20', label: 'DS18B20 — Temp Sonda' },
  { type: 'GPS', label: 'GPS — Posición' },
  { type: 'BAT', label: 'Batería' },
]

export default function NewDevicePage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [selectedSensors, setSelectedSensors] = useState<string[]>(['SHTC3', 'DS18B20', 'BAT'])
  const [deviceType, setDeviceType] = useState<'emisor' | 'receptor'>('emisor')
  const [assignedGateway, setAssignedGateway] = useState<string>('')

  const { data: receptors = [] } = useQuery({
    queryKey: ['receptors'],
    queryFn: getReceptors,
    enabled: deviceType === 'emisor',
  })

  const mutation = useMutation({
    mutationFn: createDevice,
    onSuccess: (device) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Dispositivo registrado')
      router.push(`/devices/${device.id}`)
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data
      let msg = 'Error al registrar el dispositivo'
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const parts = Object.entries(data as Record<string, unknown>)
          .map(([k, v]) => {
            const val = Array.isArray(v) ? v.join(', ') : String(v)
            return `${k}: ${val}`
          })
        if (parts.length) msg = parts.join(' | ')
      }
      toast.error(msg)
    },
  })

  function toggleSensor(type: string) {
    setSelectedSensors((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const config: Record<string, unknown> = {
      sleep_minutes: Number(form.get('sleep_minutes') ?? 10),
    }
    if (deviceType === 'receptor') {
      config.wifi_ssid = form.get('wifi_ssid') as string
      config.wifi_pass = form.get('wifi_pass') as string
    }
    mutation.mutate({
      device_id: form.get('device_id') as string,
      name: form.get('name') as string,
      device_type: deviceType,
      config,
      sensors: deviceType === 'emisor'
        ? selectedSensors.map((t) => ({ sensor_type: t, label: '' }))
        : [],
      assigned_gateway: deviceType === 'emisor' && assignedGateway
        ? Number(assignedGateway)
        : null,
    })
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Registrar nuevo nodo</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información del dispositivo</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Tipo */}
            <div className="space-y-2">
              <Label>Tipo de nodo</Label>
              <div className="flex gap-2">
                {(['emisor', 'receptor'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setDeviceType(t)}
                    className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                      deviceType === t ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 hover:bg-gray-50'
                    }`}>
                    {t === 'emisor' ? '📡 Emisor (Sensor)' : '🔌 Receptor (Gateway)'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {deviceType === 'emisor'
                  ? 'Lee sensores y transmite por LoRa.'
                  : 'Recibe por LoRa y reenvía a la plataforma por WiFi.'}
              </p>
            </div>

            {/* Nombre */}
            <div className="space-y-1">
              <Label htmlFor="name">Nombre amigable</Label>
              <Input id="name" name="name"
                placeholder={deviceType === 'emisor' ? 'Parcela Norte — Suelo' : 'Gateway Invernadero A'}
                required />
            </div>

            {/* Device ID */}
            <div className="space-y-1">
              <Label htmlFor="device_id">
                ID del dispositivo
                <span className="text-muted-foreground font-normal ml-1 text-xs">
                  (se usará en el firmware generado)
                </span>
              </Label>
              <Input id="device_id" name="device_id"
                placeholder="agro-norte-001"
                required />
            </div>

            {/* WiFi — solo receptor */}
            {deviceType === 'receptor' && (
              <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-800">
                  🔌 Credenciales WiFi del gateway
                </p>
                <p className="text-xs text-blue-700">
                  La plataforma las embebe en el firmware al hacer flash, así el ESP32 sabe a qué red conectarse.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="wifi_ssid">Red WiFi (SSID)</Label>
                  <Input id="wifi_ssid" name="wifi_ssid" placeholder="Mi_Red_WiFi" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wifi_pass">Contraseña WiFi</Label>
                  <Input id="wifi_pass" name="wifi_pass" type="password" placeholder="••••••••" required />
                </div>
              </div>
            )}

            {/* Sensores + receptor asignado — solo emisor */}
            {deviceType === 'emisor' && (
              <>
                <div className="space-y-2">
                  <Label>Sensores instalados</Label>
                  <div className="flex flex-wrap gap-2">
                    {SENSOR_OPTIONS.map(({ type, label }) => (
                      <button key={type} type="button" onClick={() => toggleSensor(type)}
                        className="focus:outline-none">
                        <Badge
                          variant={selectedSensors.includes(type) ? 'default' : 'outline'}
                          className={selectedSensors.includes(type) ? 'bg-green-600 cursor-pointer' : 'cursor-pointer'}>
                          {label}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sleep_minutes">Intervalo de envío (minutos)</Label>
                  <Input id="sleep_minutes" name="sleep_minutes" type="number"
                    min={1} max={60} defaultValue={10} required />
                  <p className="text-xs text-muted-foreground">
                    El nodo dormirá este tiempo entre cada lectura para ahorrar batería.
                  </p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="assigned_gateway">Receptor (gateway) asignado</Label>
                  {receptors.length === 0 ? (
                    <p className="text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded-md px-3 py-2">
                      No hay receptores registrados aún. Puedes asignarlo más tarde.
                    </p>
                  ) : (
                    <select
                      id="assigned_gateway"
                      value={assignedGateway}
                      onChange={(e) => setAssignedGateway(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Sin asignar</option>
                      {receptors.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.device_id})
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Receptor LoRa que reenvía los datos de este emisor a la plataforma.
                  </p>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {mutation.isPending ? 'Registrando…' : 'Registrar dispositivo'}
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
