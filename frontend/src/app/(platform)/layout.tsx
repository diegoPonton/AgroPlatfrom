'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { logout } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const NAV = [
  { href: '/devices', label: '📡 Dispositivos' },
  { href: '/topology', label: '🗺️ Topología' },
  { href: '/firmware', label: '💾 Firmware' },
  { href: '/firmware/wizard', label: '✨ Nuevo nodo' },
  { href: '/guide', label: '📖 Guía' },
]

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAppStore((s) => s.user)

  useEffect(() => {
    if (!localStorage.getItem('access_token')) {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <span className="font-bold text-green-700 text-lg">AgroESP32</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'block px-3 py-2 rounded-md text-sm font-medium transition-colors',
                pathname.startsWith(href)
                  ? 'bg-green-50 text-green-700'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t">
          <p className="text-xs text-muted-foreground truncate mb-2">{user?.email ?? '…'}</p>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
