import { api } from './api'

export interface AuthUser {
  id: number
  email: string
  name: string
}

export interface Organization {
  id: number
  name: string
  created_at: string
}

export async function login(email: string, password: string) {
  const { data } = await api.post('/api/auth/login/', { email, password })
  localStorage.setItem('access_token', data.access)
  localStorage.setItem('refresh_token', data.refresh)
  return data
}

export async function register(email: string, name: string, password: string) {
  const { data } = await api.post('/api/auth/register/', { email, name, password })
  localStorage.setItem('access_token', data.access)
  localStorage.setItem('refresh_token', data.refresh)
  return data
}

export function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  window.location.href = '/login'
}

export async function getMe(): Promise<{ user: AuthUser; organizations: Organization[] }> {
  const { data } = await api.get('/api/auth/me/')
  return data
}
