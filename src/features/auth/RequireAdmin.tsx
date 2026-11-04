import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState, ErrorState } from '@/components/shared/states'
import { useAuth } from './AuthContext'
import { MfaChallenge } from './MfaChallenge'

/** Guard de UX. La autorización real la imponen las políticas RLS en la base de datos. */
export function RequireAdmin() {
  const { status, isAdmin } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="p-8">
        <LoadingState label="Verificando sesión…" />
      </div>
    )
  }
  if (status === 'error') {
    return <ErrorState message="No se pudo verificar tu sesión. Intenta de nuevo." />
  }
  if (status === 'anonymous') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  if (status === 'mfa_required') {
    return <MfaChallenge />
  }
  if (!isAdmin) {
    return <Navigate to="/admin/login" replace state={{ denied: true }} />
  }
  return <Outlet />
}
