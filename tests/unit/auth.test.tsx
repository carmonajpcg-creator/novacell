import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext, type AuthState } from '@/features/auth/AuthContext'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAdmin } from '@/features/auth/RequireAdmin'

vi.mock('@/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: true }))

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: 'anonymous',
    role: null,
    email: null,
    isAdmin: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  }
}

function renderAt(path: string, state: AuthState) {
  return render(
    <AuthContext.Provider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/login" element={<div>pantalla login</div>} />
          <Route path="/admin" element={<RequireAdmin />}>
            <Route index element={<div>panel privado</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RequireAdmin', () => {
  it('redirige al login sin sesión', () => {
    renderAt('/admin', auth())
    expect(screen.getByText('pantalla login')).toBeInTheDocument()
    expect(screen.queryByText('panel privado')).not.toBeInTheDocument()
  })
  it('redirige a un usuario autenticado sin rol admin', () => {
    renderAt('/admin', auth({ status: 'authenticated', role: 'employee' }))
    expect(screen.queryByText('panel privado')).not.toBeInTheDocument()
    expect(screen.getByText('pantalla login')).toBeInTheDocument()
  })
  it('muestra el panel al administrador', () => {
    renderAt('/admin', auth({ status: 'authenticated', role: 'admin', isAdmin: true }))
    expect(screen.getByText('panel privado')).toBeInTheDocument()
  })
  it('muestra carga mientras verifica la sesión', () => {
    renderAt('/admin', auth({ status: 'loading' }))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('LoginPage', () => {
  it('valida los campos antes de enviar', async () => {
    const signIn = vi.fn()
    render(
      <AuthContext.Provider value={auth({ signIn })}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    await userEvent.type(screen.getByLabelText('Correo'), 'no-es-correo')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('Ingresa un correo válido')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })
})

