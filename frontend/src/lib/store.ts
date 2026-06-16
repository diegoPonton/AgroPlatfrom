import { create } from 'zustand'
import type { AuthUser, Organization } from './auth'

interface AppState {
  user: AuthUser | null
  organizations: Organization[]
  activeOrg: Organization | null
  setUser: (user: AuthUser, orgs: Organization[]) => void
  setActiveOrg: (org: Organization) => void
  clear: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  organizations: [],
  activeOrg: null,
  setUser: (user, organizations) =>
    set({ user, organizations, activeOrg: organizations[0] ?? null }),
  setActiveOrg: (org) => set({ activeOrg: org }),
  clear: () => set({ user: null, organizations: [], activeOrg: null }),
}))
