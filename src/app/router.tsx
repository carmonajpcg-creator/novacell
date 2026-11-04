import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { LoadingState } from '@/components/shared/states'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { adminNav } from '@/components/layout/adminNav'
import { LoginPage, RequireAdmin } from '@/features/auth'
import { AdminSectionPage, NotFoundPage } from './pages'

// Cada pantalla se descarga solo cuando se visita (el visitante de la tienda no baja el código del panel).
const CreditDetailPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.CreditDetailPage })),
)
const CreditsPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.CreditsPage })),
)
const CreditStatementPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.CreditStatementPage })),
)
const NewCreditPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.NewCreditPage })),
)
const PaymentReceiptPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.PaymentReceiptPage })),
)
const PaymentsPage = lazy(() =>
  import('@/features/credits').then((m) => ({ default: m.PaymentsPage })),
)
const CartPage = lazy(() => import('@/features/catalog').then((m) => ({ default: m.CartPage })))
const CatalogPage = lazy(() =>
  import('@/features/catalog').then((m) => ({ default: m.CatalogPage })),
)
const ContactPage = lazy(() =>
  import('@/features/catalog').then((m) => ({ default: m.ContactPage })),
)
const ProductPage = lazy(() =>
  import('@/features/catalog').then((m) => ({ default: m.ProductPage })),
)
const StoreHomePage = lazy(() =>
  import('@/features/catalog').then((m) => ({ default: m.StoreHomePage })),
)
const CollectionsPage = lazy(() =>
  import('@/features/collections').then((m) => ({ default: m.CollectionsPage })),
)
const DashboardPage = lazy(() =>
  import('@/features/dashboard').then((m) => ({ default: m.DashboardPage })),
)
const CustomerDetailPage = lazy(() =>
  import('@/features/customers').then((m) => ({ default: m.CustomerDetailPage })),
)
const CustomersPage = lazy(() =>
  import('@/features/customers').then((m) => ({ default: m.CustomersPage })),
)
const DeliveriesPage = lazy(() =>
  import('@/features/deliveries').then((m) => ({ default: m.DeliveriesPage })),
)
const DeliveryDetailPage = lazy(() =>
  import('@/features/deliveries').then((m) => ({ default: m.DeliveryDetailPage })),
)
const InventoryPage = lazy(() =>
  import('@/features/inventory').then((m) => ({ default: m.InventoryPage })),
)
const ProductDetailPage = lazy(() =>
  import('@/features/inventory').then((m) => ({ default: m.ProductDetailPage })),
)
const ProductsPage = lazy(() =>
  import('@/features/inventory').then((m) => ({ default: m.ProductsPage })),
)
const LayawayDetailPage = lazy(() =>
  import('@/features/layaways').then((m) => ({ default: m.LayawayDetailPage })),
)
const LayawaysPage = lazy(() =>
  import('@/features/layaways').then((m) => ({ default: m.LayawaysPage })),
)
const NewLayawayPage = lazy(() =>
  import('@/features/layaways').then((m) => ({ default: m.NewLayawayPage })),
)
const NewSalePage = lazy(() => import('@/features/sales').then((m) => ({ default: m.NewSalePage })))
const ReceiptPage = lazy(() => import('@/features/sales').then((m) => ({ default: m.ReceiptPage })))
const SaleDetailPage = lazy(() =>
  import('@/features/sales').then((m) => ({ default: m.SaleDetailPage })),
)
const SalesPage = lazy(() => import('@/features/sales').then((m) => ({ default: m.SalesPage })))
const ReportsPage = lazy(() =>
  import('@/features/reports').then((m) => ({ default: m.ReportsPage })),
)
const SettingsPage = lazy(() =>
  import('@/features/settings').then((m) => ({ default: m.SettingsPage })),
)

/** Secciones ya implementadas; el resto muestra un marcador "en construcción". */
const implemented = new Set([
  '/admin/productos',
  '/admin/inventario',
  '/admin/clientes',
  '/admin/ventas',
  '/admin/creditos',
  '/admin/abonos',
  '/admin/apartados',
  '/admin/cobranza',
  '/admin/configuracion',
  '/admin/entregas',
  '/admin/reportes',
  '/admin',
])

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
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
            <Route index element={<DashboardPage />} />
            <Route path="entregas" element={<DeliveriesPage />} />
            <Route path="entregas/:id" element={<DeliveryDetailPage />} />
            <Route path="reportes" element={<ReportsPage />} />
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
    </Suspense>
  )
}
