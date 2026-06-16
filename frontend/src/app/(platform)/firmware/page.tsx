'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
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
}

async function getFirmwareList(): Promise<FirmwareBuild[]> {
  const { data } = await api.get('/api/firmware/')
  return data
}

export default function FirmwarePage() {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const { data: builds = [], isLoading } = useQuery({
    queryKey: ['firmware'],
    queryFn: getFirmwareList,
  })

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setUploading(true)
    const form = new FormData(e.currentTarget)
    try {
      await api.post('/api/firmware/', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Firmware subido correctamente')
      qc.invalidateQueries({ queryKey: ['firmware'] })
      ;(e.target as HTMLFormElement).reset()
    } catch {
      toast.error('Error al subir el firmware')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Firmware</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Subir nuevo build</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="version">Versión</Label>
                <Input id="version" name="version" placeholder="1.0.0" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="target">Target</Label>
                <select
                  id="target"
                  name="target"
                  required
                  className="w-full border rounded-md px-3 py-2 text-sm"
                >
                  <option value="emisor">Emisor (Sensor)</option>
                  <option value="receptor">Receptor (Gateway)</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="binary">Archivo .bin</Label>
              <Input id="binary" name="binary" type="file" accept=".bin" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input id="notes" name="notes" placeholder="Cambios en esta versión…" />
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/80 transition-colors disabled:opacity-50"
            >
              {uploading ? 'Subiendo…' : 'Subir firmware'}
            </button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : builds.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Sin builds aún</CardContent></Card>
        ) : (
          builds.map((b) => (
            <Card key={b.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">v{b.version}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(b.compiled_at), "d MMM yyyy, HH:mm", { locale: es })}
                    {b.notes && ` — ${b.notes}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{b.target}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`/api/firmware/${b.id}/download/`, '_blank')}
                  >
                    ↓ Descargar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
