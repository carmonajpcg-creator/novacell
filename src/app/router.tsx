import { Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { adminNav } from '@/components/layout/adminNav'
import { LoginPage, RequireAdmin } from '@/features/auth'
import { CreditDetailPage, CreditsPage, CreditStatementPage, NewCreditPage, PaymentReceiptPage, PaymentsPage } from '@/features/credits'
import { CartPage, CatalogPage, ContactPage, ProductPage, StoreHomePage } from '@/features/catalog'
import { CollectionsPage } from '@/features/collections'
import { CustomerDetailPage, CustomersPage } from '@/features/customers'
import { InventoryPage, ProductDetailPage, ProductsPage } from '@/features/inventory'
import { LayawayDetailPage, LayawaysPage, NewLayawayPage } from '@/features/layaways'
import { NewSalePage, ReceiptPage, SaleDetailPage, SalesPage } from '@/features/sales'
import { SettingsPage } from '@/features/settings'
import { AdminSectionPage, NotFoundPage } from './pages'

/** Secciones ya implementadas; el resto muestra un marcador "en construcción". */
const implemented = new Set(['/admin/productos', '/admin/inventario', '/admin/clientes', '/admin/ventas', '/admin/creditos', '/admin/abonos', '/admin/apartados', '/admin/cobranza', '/admin/configuracion'])

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<StoreHomePage />} />
        <Route path="iphone" element={<CatalogPage kind="iphone" />} />
        <Route path="accesorios" element={<CatalogPage kind="accessory" />} />
        <Route path="producto/:slug" element={<ProductPage />} />
        <Route path="carrito" element={<CartPage />} />
        <Route path="contacto" element={<ContactPage />} />
      </Route>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          <Route path="productos" element={<ProductsPage />} />
          <Route path="productos/:id" element={<ProductDetailPage />} />
          <Route path="inventario" element={<InventoryPage />} />
          <Route path="clientes" element={<CustomersPage />} />
          <Route path="clientes/:id" element={<CustomerDetailPage />} />
          <Route path="ventas" element={<SalesPage />} />
          <Route path="ventas/nueva" element={<NewSalePage />} />
          <Route path="ventas/:id" element={<SaleDetailPage />} />
          <Route path="ventas/:id/comprobante" element={<ReceiptPage />} />
          <Route path="creditos" element={<CreditsPage />} />
          <Route path="creditos/nuevo" element={<NewCreditPage />} />
          <Route path="creditos/:id" element={<CreditDetailPage />} />
          <Route path="creditos/:id/estado-de-cuenta" element={<CreditStatementPage />} />
          <Route path="creditos/:id/pago/:paymentId" element={<PaymentReceiptPage />} />
          <Route path="abonos" element={<PaymentsPage />} />
          <Route path="apartados" element={<LayawaysPage />} />
          <Route path="apartados/nuevo" element={<NewLayawayPage />} />
          <Route path="apartados/:id" element={<LayawayDetailPage />} />
          <Route path="cobranza" element={<CollectionsPage />} />
          <Route path="configuracion" element={<SettingsPage />} />
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
