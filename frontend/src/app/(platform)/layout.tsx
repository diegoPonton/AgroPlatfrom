'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logout } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const NAV = [
  { href: '/devices',        label: 'Dispositivos',  icon: '📡', desc: 'Nodos y sensores' },
  { href: '/topology',       label: 'Topología',     icon: '🗺️', desc: 'Red LoRa visual' },
  { href: '/firmware',       label: 'Firmware',      icon: '💾', desc: 'Builds y versiones' },
  { href: '/firmware/wizard',label: 'Nuevo nodo',    icon: '✨', desc: 'Wizard de alta' },
  { href: '/guide',          label: 'Guía',          icon: '📖', desc: 'Documentación' },
]

function DataPulse() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 border border-green-100 mx-3 mb-3">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span className="text-xs text-green-700 font-medium">Red activa</span>
    </div>
  )
}

function Logo() {
  return (
    <div className="p-4 border-b border-gray-100">
      <div className="flex items-center gap-2.5">
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center shadow-md shadow-green-200 flex-shrink-0">
          <span className="text-base">🌱</span>
          {/* Circuit trace animation */}
          <div className="absolute inset-0 rounded-lg overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-green-300/40 animate-trace-h" />
            <div className="absolute top-0 right-0 h-full w-0.5 bg-green-300/40 animate-trace-v" />
          </div>
        </div>
        <div>
          <div className="font-bold text-gray-900 text-sm leading-tight">
            Agro<span className="text-green-600">ESP32</span>
          </div>
          <div className="text-[10px] text-gray-400 leading-tight">IoT Agrícola</div>
        </div>
      </div>
    </div>
  )
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAppStore((s) => s.user)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('access_token')) {
      router.replace('/login')
    } else {
      setVisible(true)
    }
  }, [router])

  return (
    <div className="flex min-h-screen bg-gray-50/80">
      {/* Sidebar */}
      <aside
        className={cn(
          'w-56 shrink-0 bg-white border-r border-gray-100 flex flex-col shadow-sm transition-all duration-500',
          visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
        )}
      >
        <Logo />

        <nav className="flex-1 p-3 space-y-0.5 mt-1">
          {NAV.map(({ href, label, icon, desc }, i) => {
            const active = pathname === href || (href !== '/devices' && href !== '/firmware' && pathname.startsWith(href))
              || (href === '/devices' && (pathname === '/devices' || (pathname.startsWith('/devices') && !pathname.startsWith('/devices/topology'))))
              || (href === '/firmware' && pathname === '/firmware')
            return (
              <Link
                key={href}
                href={href}
                style={{ animationDelay: `${i * 60}ms` }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group animate-slide-in-left',
                  active
                    ? 'bg-green-50 text-green-700 shadow-sm shadow-green-100'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
                )}
              >
                <span className={cn(
                  'text-base w-6 text-center transition-transform duration-200',
                  active ? 'scale-110' : 'group-hover:scale-110'
                )}>
                  {icon}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="leading-tight">{label}</span>
                  <span className={cn(
                    'text-[10px] leading-tight transition-colors',
                    active ? 'text-green-500' : 'text-gray-400'
                  )}>
                    {desc}
                  </span>
                </div>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
              </Link>
            )
          })}
        </nav>

        <DataPulse />

        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <p className="text-xs text-gray-500 truncate flex-1">{user?.email ?? '…'}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors rounded-lg"
            onClick={logout}
          >
            <span className="mr-2">🚪</span> Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main
        className={cn(
          'flex-1 overflow-auto p-6 transition-all duration-500',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      >
        {children}
      </main>
    </div>
  )
}
