import { Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { adminNav } from '@/components/layout/adminNav'
import { LoginPage, RequireAdmin } from '@/features/auth'
import { AdminSectionPage, HomePage, NotFoundPage } from './pages'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
      </Route>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          {adminNav.map(({ to, end }) => (
            <Route
              key={to}
              {...(end ? { index: true } : { path: to.replace('/admin/', '') })}
              element={<AdminSectionPage />}
            />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
