import { api } from './api'

export interface Sensor {
  id: number
  sensor_type: string
  label: string
}

export interface Device {
  id: number
  device_id: string
  name: string
  device_type: 'emisor' | 'receptor'
  firmware_version: string
  last_seen: string | null
  is_online: boolean
  provisioning_token: string
  config: Record<string, unknown>
  sensors: Sensor[]
  created_at: string
  assigned_gateway: number | null
  assigned_gateway_name: string | null
}

export async function getDevices(): Promise<Device[]> {
  const { data } = await api.get('/api/devices/')
  return data
}

export async function getDevice(id: number): Promise<Device> {
  const { data } = await api.get(`/api/devices/${id}/`)
  return data
}

export async function getReceptors(): Promise<Device[]> {
  const { data } = await api.get('/api/devices/receptors/')
  return data
}

export async function createDevice(payload: {
  device_id: string
  name: string
  device_type: string
  config?: Record<string, unknown>
  sensors?: { sensor_type: string; label: string }[]
  assigned_gateway?: number | null
}): Promise<Device> {
  const { data } = await api.post('/api/devices/', payload)
  return data
}

export async function updateDevice(id: number, payload: Partial<{
  name: string
  config: Record<string, unknown>
  assigned_gateway: number | null
  firmware_version: string
}>): Promise<Device> {
  const { data } = await api.patch(`/api/devices/${id}/`, payload)
  return data
}

export async function deleteDevice(id: number) {
  await api.delete(`/api/devices/${id}/`)
}

export async function getTelemetryHistory(deviceId: number, hours = 24, limit = 500) {
  const { data } = await api.get(`/api/devices/${deviceId}/telemetry/?hours=${hours}&limit=${limit}`)
  return data
}

export type CommandType =
  | 'set_sleep'
  | 'enable_sensor'
  | 'set_device_id'
  | 'restart'

export interface DeviceCommand {
  id: number
  command_type: CommandType
  command_label: string
  params: Record<string, unknown>
  status: 'pending' | 'relayed' | 'acked' | 'failed'
  created_at: string
  relayed_at: string | null
  acked_at: string | null
}

export async function getDeviceCommands(emitterId: number): Promise<DeviceCommand[]> {
  const { data } = await api.get(`/api/devices/${emitterId}/commands/`)
  return data
}

export async function createCommand(
  emitterId: number,
  command_type: CommandType,
  params: Record<string, unknown> = {},
): Promise<DeviceCommand> {
  const { data } = await api.post(`/api/devices/${emitterId}/commands/`, { command_type, params })
  return data
}

export async function deleteCommand(cmdId: number): Promise<void> {
  await api.delete(`/api/commands/${cmdId}/`)
}
