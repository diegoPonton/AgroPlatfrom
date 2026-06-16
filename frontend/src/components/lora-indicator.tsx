'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/** Animated LoRa signal rings for online devices */
export function LoraIndicator({ online, size = 'md', className }: {
  online: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = { sm: 16, md: 24, lg: 36 }
  const px = sizes[size]

  if (!online) {
    return (
      <div
        className={cn('rounded-full bg-gray-200 flex-shrink-0', className)}
        style={{ width: px, height: px }}
      />
    )
  }

  return (
    <div className={cn('relative flex-shrink-0 flex items-center justify-center', className)} style={{ width: px, height: px }}>
      {/* Rings */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute inset-0 rounded-full border border-green-400 lora-wave"
          style={{ animationDelay: `${i * 0.5}s` }}
        />
      ))}
      {/* Core dot */}
      <span className="relative z-10 rounded-full bg-green-500 animate-online-dot" style={{ width: px * 0.35, height: px * 0.35 }} />
    </div>
  )
}

/** Mini ESP32 chip SVG icon */
export function Esp32Icon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('w-5 h-5', className)}>
      <rect x="4" y="8" width="24" height="16" rx="2" fill="#1a3d1a" stroke="#2d7a2d" strokeWidth="1.5" />
      <rect x="9" y="11" width="14" height="10" rx="1" fill="#2d7a2d" />
      <rect x="12" y="13" width="8" height="6" rx="0.5" fill="#22c55e" />
      {/* Antenna */}
      <line x1="22" y1="8" x2="22" y2="3" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="22" y1="3" x2="25" y2="3" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
      {/* Pins left */}
      {[10,13,16,19,22].map((y) => (
        <line key={y} x1="4" y1={y} x2="1" y2={y} stroke="#666" strokeWidth="1" />
      ))}
      {/* Pins right */}
      {[10,13,16,19,22].map((y) => (
        <line key={y} x1="28" y1={y} x2="31" y2={y} stroke="#666" strokeWidth="1" />
      ))}
    </svg>
  )
}

/** Floating data packet animation */
export function DataPackets({ count = 3 }: { count?: number }) {
  return (
    <div className="relative h-8 w-16 overflow-visible">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute bottom-0 left-1/2 w-1.5 h-1.5 rounded-full bg-green-400 animate-data-float"
          style={{
            animationDelay: `${i * 0.6}s`,
            left: `${20 + i * 20}%`,
          }}
        />
      ))}
    </div>
  )
}
