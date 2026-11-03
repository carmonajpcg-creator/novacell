import { Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { adminNav } from '@/components/layout/adminNav'
import { LoginPage, RequireAdmin } from '@/features/auth'
import { InventoryPage, ProductDetailPage, ProductsPage } from '@/features/inventory'
import { AdminSectionPage, HomePage, NotFoundPage } from './pages'

/** Secciones ya implementadas; el resto muestra un marcador "en construcción". */
const implemented = new Set(['/admin/productos', '/admin/inventario'])

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
      </Route>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          <Route path="productos" element={<ProductsPage />} />
          <Route path="productos/:id" element={<ProductDetailPage />} />
          <Route path="inventario" element={<InventoryPage />} />
          {adminNav
            .filter(({ to }) => !implemented.has(to))
            .map(({ to, end }) => (
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
