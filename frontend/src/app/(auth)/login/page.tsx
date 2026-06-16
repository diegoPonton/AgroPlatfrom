'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { login, getMe } from '@/lib/auth'
import { useAppStore } from '@/lib/store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import dynamic from 'next/dynamic'

const AgroScene = dynamic(
  () => import('@/components/agro-scene').then((m) => m.AgroScene),
  { ssr: false }
)

export default function LoginPage() {
  const router = useRouter()
  const setUser = useAppStore((s) => s.setUser)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const form = new FormData(e.currentTarget)
    try {
      await login(form.get('email') as string, form.get('password') as string)
      const { user, organizations } = await getMe()
      setUser(user, organizations)
      router.push('/devices')
    } catch {
      toast.error('Credenciales incorrectas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#071410]">
      {/* Three.js background */}
      <div className="absolute inset-0">
        {mounted && <AgroScene />}
      </div>

      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#071410]/20 to-[#071410]/60 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
        {/* Logo */}
        <div className="mb-8 text-center animate-fade-in">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/20 border border-green-500/40 flex items-center justify-center backdrop-blur-sm">
              <span className="text-xl">🌱</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Agro<span className="text-green-400">ESP32</span>
            </h1>
          </div>
          <p className="text-green-300/70 text-sm tracking-widest uppercase">
            Plataforma IoT Agrícola
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm animate-slide-up">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-8">
            <h2 className="text-white font-semibold text-lg mb-1">Iniciar sesión</h2>
            <p className="text-white/40 text-sm mb-6">Accede al panel de control</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-white/70 text-xs uppercase tracking-wider">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-green-400/60 focus:ring-green-400/20 rounded-xl h-11"
                  placeholder="usuario@campo.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-white/70 text-xs uppercase tracking-wider">
                  Contraseña
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-green-400/60 focus:ring-green-400/20 rounded-xl h-11"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="relative w-full h-11 rounded-xl bg-green-500 hover:bg-green-400 text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-green-400/0 via-white/10 to-green-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Conectando…
                  </span>
                ) : 'Entrar al sistema'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-white/10 text-center">
              <p className="text-white/40 text-sm">
                ¿No tienes cuenta?{' '}
                <Link href="/register" className="text-green-400 hover:text-green-300 transition-colors font-medium">
                  Regístrate gratis
                </Link>
              </p>
            </div>
          </div>

          {/* Status indicator */}
          <div className="mt-4 flex items-center justify-center gap-2 text-white/30 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Sensores activos · Datos en tiempo real
          </div>
        </div>
      </div>
    </div>
  )
}
