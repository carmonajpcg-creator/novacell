import { createContext, useContext } from 'react'
import type { UserRole } from './api'

export interface AuthState {
  status: 'loading' | 'anonymous' | 'mfa_required' | 'authenticated' | 'error'
  role: UserRole | null
  email: string | null
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
