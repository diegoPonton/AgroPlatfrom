'use client'

import dynamic from 'next/dynamic'

const GpsMap = dynamic(() => import('@/components/gps-map'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
      <span className="animate-spin text-xl">🛰️</span>
      <span>Cargando mapa GPS…</span>
    </div>
  ),
})

export default function MapPage() {
  return (
    <div className="h-[calc(100vh-5rem)] -m-6 overflow-hidden">
      <GpsMap />
    </div>
  )
}
